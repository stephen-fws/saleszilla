"""Email thread service — three data sources, merged:

1. MS Graph (live) — for any thread where we have a conversationId from a
   Salezilla-sent email. Returns the full conversation including Outlook-sent
   and client replies in real time.
2. CX_SentEmails — Salezilla-sent emails (immediate, no sync dependency).
3. VW_CRM_Sales_Sync_Emails — sync service captures (covers Outlook-sent +
   inbound for threads we don't have a conversationId for). Always queried by
   the 7-digit potential_number via the view's PotentialNumber column.

Priority: Graph > CX_SentEmails > sync table.
Deduplication by internetMessageId across all sources.

Threading heuristic for non-Graph data: group by cleaned subject (strip RE:/FW:).
"""

import asyncio
import logging
import re
from collections import OrderedDict

from sqlalchemy import select, text

from core.database import get_session
from core.models import CXSentEmail, CXUserToken, Potential, User
from core.schemas import EmailMessage, EmailThread, EmailThreadsResponse

logger = logging.getLogger(__name__)
_RE_PREFIX = re.compile(r"^(?:re|fw|fwd)\s*:\s*", re.IGNORECASE)


def _clean_subject(subject: str) -> str:
    s = (subject or "").strip()
    while True:
        cleaned = _RE_PREFIX.sub("", s).strip()
        if cleaned == s:
            break
        s = cleaned
    return s or "(no subject)"


# Description from the sync table is the full email thread in HTML — but it's
# Outlook-flavoured: bloated with mso-* conditionals, <script>/<style> tags,
# and inline event handlers. Strip the junk so the frontend can render it
# inside `dangerouslySetInnerHTML` safely.
_SCRIPT_STYLE_RE = re.compile(r"<(script|style)\b[^>]*>[\s\S]*?</\1>", re.IGNORECASE)
_COMMENT_RE = re.compile(r"<!--[\s\S]*?-->")
_MSO_BLOCK_RE = re.compile(r"<!--\s*\[if[\s\S]*?<!\s*\[endif\]\s*-->", re.IGNORECASE)
_INLINE_HANDLER_RE = re.compile(r'\s+on[a-z]+\s*=\s*"[^"]*"|\s+on[a-z]+\s*=\s*\'[^\']*\'', re.IGNORECASE)
_MSO_STYLE_DECL_RE = re.compile(r"mso-[a-z-]+\s*:[^;\"']+;?", re.IGNORECASE)
# Inline `cid:` images (Outlook signature images, etc.). The image binary
# lives as an attachment in the original Outlook message — sync table
# doesn't carry it, so the browser can't resolve `cid:foo@bar` and shows a
# broken-image icon. Strip the <img> tag entirely; the rest of the
# signature (text, links) still renders.
_CID_IMG_RE = re.compile(r"<img\b[^>]*\bsrc\s*=\s*[\"']cid:[^\"']+[\"'][^>]*>", re.IGNORECASE)


def _sanitize_email_html(html: str | None) -> str:
    """Clean Outlook-flavoured HTML before rendering. Returns empty string when
    the input is None/empty/effectively-empty after stripping (lets callers
    fall back to UniqueBody)."""
    if not html:
        return ""
    out = html
    out = _MSO_BLOCK_RE.sub("", out)            # <!--[if mso]>…<![endif]-->
    out = _COMMENT_RE.sub("", out)              # other HTML comments
    out = _SCRIPT_STYLE_RE.sub("", out)         # <script>/<style> blocks
    out = _INLINE_HANDLER_RE.sub("", out)       # onclick=… etc.
    out = _MSO_STYLE_DECL_RE.sub("", out)       # mso-* CSS declarations
    out = _CID_IMG_RE.sub("", out)              # broken cid: signature images
    # If after stripping the visible-text length is tiny, treat as broken/empty.
    text_only = re.sub(r"<[^>]+>", "", out).strip()
    if len(text_only) < 20:
        return ""
    return out


def _format_plain_body(text: str | None) -> str:
    """Convert plain `UniqueBody` into readable HTML — split on blank lines
    into <p> blocks and convert single \n into <br>. Prevents the legacy
    'one massive paragraph' rendering for Shape #1 / fallback emails."""
    if not text:
        return ""
    escaped = (text
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;"))
    blocks = [b.strip() for b in re.split(r"\n\s*\n", escaped) if b.strip()]
    return "".join(f"<p>{b.replace(chr(10), '<br>')}</p>" for b in blocks)


def _load_sales_emails() -> set[str]:
    with get_session() as session:
        user_rows = session.execute(select(User.email)).all()
        ms_rows = session.execute(
            select(CXUserToken.ms_email).where(CXUserToken.is_active == True, CXUserToken.ms_email.is_not(None))
        ).all()
    emails = {r[0].lower() for r in user_rows if r[0]}
    emails.update({r[0].lower() for r in ms_rows if r[0]})
    return emails


def _graph_msg_to_email_message(m: dict, idx: int) -> EmailMessage:
    from core.schemas import EmailMessageAttachment
    atts = [
        EmailMessageAttachment(id=a.get("id", ""), name=a.get("name", "attachment"), content_type=a.get("content_type", ""), size=a.get("size", 0))
        for a in (m.get("attachments") or [])
    ]
    return EmailMessage(
        id=idx,
        from_email=m.get("from_email") or "",
        to_email=m.get("to_email") or "",
        cc=m.get("cc"),
        bcc=m.get("bcc"),
        subject=m.get("subject") or "",
        body=m.get("body"),
        direction=m.get("direction") or "received",
        sent_time=m.get("sent_time"),
        received_time=m.get("received_time"),
        internet_message_id=m.get("internet_message_id"),
        thread_id=m.get("conversation_id"),
        graph_message_id=m.get("graph_message_id"),
        has_attachments=bool(m.get("has_attachments") or atts),
        attachments=atts,
    )


def get_email_threads(potential_id: str, potential_number: str) -> EmailThreadsResponse:
    """Return all email threads for a potential.

    For threads with a known conversationId (from Salezilla-sent emails), fetch
    the full conversation live from MS Graph — this includes Outlook-sent
    follow-ups and client replies in real time.

    For threads without a conversationId (old sync data), fall back to the sync
    table grouped by cleaned subject.
    """
    sales_emails = _load_sales_emails()
    seen_msg_ids: set[str] = set()
    threads: list[EmailThread] = []

    # ── Phase 1: Collect unique conversationIds from Salezilla-sent emails ────
    with get_session() as session:
        sz_rows = session.execute(
            select(CXSentEmail).where(
                CXSentEmail.potential_id == potential_id,
                CXSentEmail.is_active == True,
            ).order_by(CXSentEmail.sent_time)
        ).scalars().all()

        # Resolve the potential owner for Graph token
        owner_id = session.execute(
            select(Potential.potential_owner_id).where(Potential.potential_id == potential_id)
        ).scalar_one_or_none()

    # Group Salezilla-sent by conversationId
    conv_ids: OrderedDict[str, list[CXSentEmail]] = OrderedDict()
    sz_no_conv: list[CXSentEmail] = []
    for r in sz_rows:
        if r.thread_id:
            conv_ids.setdefault(r.thread_id, []).append(r)
        else:
            sz_no_conv.append(r)

    # ── Phase 2: Fetch live threads from Graph for each conversationId ────────
    graph_token = None
    if conv_ids and owner_id:
        try:
            from core.ms_graph import get_valid_ms_token
            graph_token = asyncio.run(get_valid_ms_token(owner_id))
        except Exception as exc:
            logger.warning("email_thread: failed to get MS token for owner=%s: %s", owner_id, exc)

    if graph_token and conv_ids:
        from core.ms_graph import fetch_thread_by_conversation_id
        for conv_id, sz_msgs in conv_ids.items():
            try:
                graph_msgs = fetch_thread_by_conversation_id(graph_token, conv_id)
            except Exception as exc:
                logger.warning("email_thread: Graph fetch failed for conv=%s: %s", conv_id, exc)
                graph_msgs = []

            if graph_msgs:
                messages: list[EmailMessage] = []
                for i, gm in enumerate(graph_msgs):
                    msg = _graph_msg_to_email_message(gm, i)
                    if msg.internet_message_id:
                        seen_msg_ids.add(msg.internet_message_id)
                    messages.append(msg)

                subject = messages[0].subject if messages else sz_msgs[0].subject or ""
                last_ts = None
                for m in reversed(messages):
                    ts = m.sent_time or m.received_time
                    if ts:
                        last_ts = ts
                        break

                threads.append(EmailThread(
                    thread_key=f"graph:{conv_id}",
                    subject=_clean_subject(subject),
                    messages=messages,
                    last_activity=last_ts,
                    message_count=len(messages),
                    reply_thread_id=conv_id,
                    reply_to_message_id=messages[-1].internet_message_id if messages else None,
                ))
            else:
                # Graph returned nothing (token expired, message deleted, etc.)
                # Fall through to DB-only path for these messages
                sz_no_conv.extend(sz_msgs)

            # Mark all Salezilla-sent internetMessageIds as seen so they don't duplicate
            for r in sz_msgs:
                if r.internet_message_id:
                    seen_msg_ids.add(r.internet_message_id)
    else:
        # No Graph token — treat all Salezilla-sent as local-only
        sz_no_conv.extend(r for msgs in conv_ids.values() for r in msgs)

    # ── Phase 3: Salezilla-sent emails without conversationId ─────────────────
    local_messages: list[tuple[str, EmailMessage]] = []
    for r in sz_no_conv:
        if r.internet_message_id and r.internet_message_id in seen_msg_ids:
            continue
        if r.internet_message_id:
            seen_msg_ids.add(r.internet_message_id)
        msg = EmailMessage(
            id=r.id,
            from_email=r.from_email or "",
            to_email=r.to_email or "",
            cc=r.cc_emails,
            bcc=r.bcc_emails,
            subject=r.subject or "",
            body=r.body,
            direction="sent",
            sent_time=r.sent_time,
            received_time=None,
            internet_message_id=r.internet_message_id,
            thread_id=r.thread_id,
        )
        local_messages.append((_clean_subject(r.subject or ""), msg))

    # ── Phase 4: Sync table emails ────────────────────────────────────────────
    # Split sync emails into those with internetMessageId (can resolve via
    # Graph to "heal" flat threads) and those without (stay flat).
    with get_session() as session:
        sync_rows = session.execute(text("""
            SELECT
                id, [From], [To], CC, [Subject], UniqueBody,
                SentTime, ReceivedTime, internetMessageID, [Description],
                Outlook_ConversationId
            FROM VW_CRM_Sales_Sync_Emails
            WHERE PotentialNumber = :pn
            ORDER BY COALESCE(SentTime, ReceivedTime) ASC
        """), {"pn": potential_number}).all()

    # Collect unseen sync emails with internetMessageId → try to heal via Graph
    sync_with_msgid: list[str] = []
    for row in sync_rows:
        internet_msg_id = row[8]
        if internet_msg_id and internet_msg_id not in seen_msg_ids:
            sync_with_msgid.append(internet_msg_id)

    # Phase 4a: Resolve sync internetMessageIds → conversationId → Graph thread
    if graph_token and sync_with_msgid:
        from core.ms_graph import fetch_thread_by_message_id
        resolved_conv_ids: set[str] = set()
        for msg_id in sync_with_msgid:
            if msg_id in seen_msg_ids:
                continue
            try:
                graph_msgs = fetch_thread_by_message_id(graph_token, msg_id)
            except Exception as exc:
                logger.warning("email_thread: Graph heal failed for msg=%s: %s", msg_id[:40], exc)
                continue
            if not graph_msgs:
                continue
            conv_id = graph_msgs[0].get("conversation_id")
            if conv_id and conv_id in resolved_conv_ids:
                continue
            if conv_id:
                resolved_conv_ids.add(conv_id)
            messages = []
            for i, gm in enumerate(graph_msgs):
                msg = _graph_msg_to_email_message(gm, 10000 + i)
                if msg.internet_message_id:
                    seen_msg_ids.add(msg.internet_message_id)
                messages.append(msg)
            subject = messages[0].subject if messages else ""
            last_ts = None
            for m in reversed(messages):
                ts = m.sent_time or m.received_time
                if ts:
                    last_ts = ts
                    break
            threads.append(EmailThread(
                thread_key=f"graph:{conv_id or msg_id}",
                subject=_clean_subject(subject),
                messages=messages,
                last_activity=last_ts,
                message_count=len(messages),
                reply_thread_id=conv_id,
                reply_to_message_id=messages[-1].internet_message_id if messages else None,
            ))

    # Phase 4b: Remaining sync rows → render using Description (preferred)
    # or UniqueBody (Shape #1 fallback).
    #
    # When multiple rows in this potential share the same Outlook_ConversationId,
    # they're snapshots of the SAME thread at different points in time and each
    # row's Description already contains the full thread up to that message.
    # Rendering all of them = duplicated content. So per ConversationId group
    # we keep only the LATEST row's Description and drop the rest.
    #
    # Rows without Outlook_ConversationId (Shape #1 legacy) are rendered
    # individually using UniqueBody — they pre-date conversation tracking.
    grouped_by_conv: dict[str, tuple] = {}        # latest row per conv_id
    ungrouped_rows: list[tuple] = []              # no conv_id → render individually

    for row in sync_rows:
        (row_id, from_addr, to_addr, cc, subject, body,
         sent_time, received_time, internet_msg_id, description, conv_id) = row
        if internet_msg_id and internet_msg_id in seen_msg_ids:
            continue
        if conv_id:
            existing = grouped_by_conv.get(conv_id)
            if existing is None:
                grouped_by_conv[conv_id] = row
            else:
                # Keep whichever row has the more recent timestamp
                ex_ts = existing[6] or existing[7] or ""
                this_ts = sent_time or received_time or ""
                if str(this_ts) > str(ex_ts):
                    grouped_by_conv[conv_id] = row
        else:
            ungrouped_rows.append(row)

    def _emit_row(row: tuple) -> None:
        (row_id, from_addr, to_addr, cc, subject, body,
         sent_time, received_time, internet_msg_id, description, _conv_id) = row
        if internet_msg_id:
            seen_msg_ids.add(internet_msg_id)
        direction = "sent" if (from_addr and from_addr.lower() in sales_emails) else "received"
        rendered_body = _sanitize_email_html(description) or _format_plain_body(body)
        msg = EmailMessage(
            id=row_id,
            from_email=from_addr or "",
            to_email=to_addr or "",
            cc=cc,
            subject=subject or "",
            body=rendered_body,
            direction=direction,
            sent_time=sent_time,
            received_time=received_time,
            internet_message_id=internet_msg_id,
            thread_id=None,
        )
        local_messages.append((_clean_subject(subject or ""), msg))

    for row in grouped_by_conv.values():
        _emit_row(row)
    for row in ungrouped_rows:
        _emit_row(row)

    # ── Phase 5: Group local messages by cleaned subject ──────────────────────
    local_messages.sort(key=lambda x: x[1].sent_time or x[1].received_time or "")
    thread_map: OrderedDict[str, list[EmailMessage]] = OrderedDict()
    for key, msg in local_messages:
        thread_map.setdefault(key, []).append(msg)

    for key, messages in thread_map.items():
        last_ts = None
        for m in reversed(messages):
            ts = m.sent_time or m.received_time
            if ts:
                last_ts = ts
                break
        reply_tid = None
        reply_mid = None
        for m in reversed(messages):
            if m.thread_id:
                reply_tid = m.thread_id
                reply_mid = m.internet_message_id
                break
        if not reply_mid:
            for m in reversed(messages):
                if m.internet_message_id:
                    reply_mid = m.internet_message_id
                    break
        is_flat = reply_tid is None and all(m.internet_message_id is None for m in messages)
        threads.append(EmailThread(
            thread_key=f"local:{key}",
            subject=messages[0].subject,
            messages=messages,
            last_activity=last_ts,
            message_count=len(messages),
            reply_thread_id=reply_tid,
            reply_to_message_id=reply_mid,
            is_flat=is_flat,
        ))

    # ── Sort all threads by last activity (most recent first) ─────────────────
    threads.sort(key=lambda t: str(t.last_activity or ""), reverse=True)
    total = sum(t.message_count for t in threads)
    return EmailThreadsResponse(threads=threads, total_messages=total)
