"""Chat service — context assembly, message persistence, Claude streaming."""

import json
import logging
from datetime import datetime, timezone
from typing import Iterator

import anthropic
from sqlalchemy import select

import core.config as config
from core.database import get_session
from core.models import (
    Account, Contact, CXActivity, CXAgentInsight, CXAgentTypeConfig,
    CXCallLog, CXChatMessage, CXNote, CXSentEmail, CXTodo,
    Potential,
)
from core.schemas import ChatMessageItem

logger = logging.getLogger(__name__)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_potential_number(potential_id: str) -> str | None:
    """Resolve the 7-digit potential_number from potential_id (UUID)."""
    with get_session() as session:
        p = session.execute(
            select(Potential.potential_number).where(Potential.potential_id == potential_id)
        ).scalar_one_or_none()
        return p


# ── Message persistence ───────────────────────────────────────────────────────
# All chat history is keyed on potential_number (7-digit), not potential_id (UUID).
# This ensures history survives any DB-level record migrations.

def list_messages(user_id: str, potential_id: str, limit: int = 100) -> list[ChatMessageItem]:
    potential_number = _get_potential_number(potential_id)
    if not potential_number:
        return []
    with get_session() as session:
        stmt = (
            select(CXChatMessage)
            .where(
                CXChatMessage.user_id == user_id,
                CXChatMessage.potential_id == potential_number,
                CXChatMessage.is_active == True,
            )
            .order_by(CXChatMessage.created_time.asc())
            .limit(limit)
        )
        return [
            ChatMessageItem(id=m.id, role=m.role, content=m.content, created_time=m.created_time)
            for m in session.execute(stmt).scalars().all()
        ]


def save_message(user_id: str, potential_id: str, role: str, content: str) -> ChatMessageItem:
    """potential_id here is the UUID — resolved to potential_number before saving."""
    potential_number = _get_potential_number(potential_id)
    if not potential_number:
        raise ValueError(f"Cannot resolve potential_number for potential_id={potential_id}")
    now = datetime.now(timezone.utc)
    with get_session() as session:
        msg = CXChatMessage(
            user_id=user_id,
            potential_id=potential_number,  # store 7-digit number
            role=role,
            content=content,
            created_time=now,
            updated_time=now,
            is_active=True,
        )
        session.add(msg)
        session.flush()
        session.refresh(msg)
        return ChatMessageItem(id=msg.id, role=msg.role, content=msg.content, created_time=msg.created_time)


def clear_history(user_id: str, potential_id: str) -> int:
    potential_number = _get_potential_number(potential_id)
    if not potential_number:
        return 0
    now = datetime.now(timezone.utc)
    with get_session() as session:
        messages = session.execute(
            select(CXChatMessage).where(
                CXChatMessage.user_id == user_id,
                CXChatMessage.potential_id == potential_number,
                CXChatMessage.is_active == True,
            )
        ).scalars().all()
        for m in messages:
            m.is_active = False
            m.updated_time = now
            session.add(m)
        return len(messages)


# ── Context assembly ──────────────────────────────────────────────────────────

def _fmt_date(dt) -> str:
    if not dt:
        return "—"
    if hasattr(dt, "strftime"):
        return dt.strftime("%Y-%m-%d")
    return str(dt)


def build_context_prompt(potential_id: str) -> str:
    """Assemble a rich system prompt with all available context for a potential."""
    lines: list[str] = []

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    lines.append(
        "You are an expert sales assistant AI embedded in Salezilla, an AI-powered CRM.\n"
        "You have full context about the sales potential below. Use it to help the salesperson "
        "with insights, drafting emails, strategising next steps, answering questions about the potential, "
        "and anything else they need.\n"
        "Be concise, specific, and actionable. Always reference actual data from the context.\n"
        f"\nToday's date: {today}\n"
    )

    with get_session() as session:
        # ── Potential + Account + Contact ─────────────────────────────────────
        row = session.execute(
            select(Potential, Account, Contact)
            .outerjoin(Account, Potential.account_id == Account.account_id)
            .outerjoin(Contact, Potential.contact_id == Contact.contact_id)
            .where(Potential.potential_id == potential_id)
        ).first()

        if not row:
            lines.append("## POTENTIAL\nNo data found.\n")
            return "\n".join(lines)

        p, a, c = row

        lines.append("## POTENTIAL")
        lines.append(f"- ID / Number: {p.potential_number or potential_id}")
        lines.append(f"- Title: {p.potential_name or '—'}")
        lines.append(f"- Stage: {p.stage or '—'}")
        lines.append(f"- Value: ${p.amount:,.0f}" if p.amount else "- Value: —")
        lines.append(f"- Probability: {p.probability}%" if p.probability is not None else "- Probability: —")
        lines.append(f"- Service: {p.service or '—'}")
        lines.append(f"- Sub-service: {p.sub_service or '—'}")
        lines.append(f"- Lead Source: {p.lead_source or '—'}")
        lines.append(f"- Potential Type: {p.type or '—'}")
        lines.append(f"- Potential Size: {p.deal_size or '—'}")
        lines.append(f"- Closing Date: {_fmt_date(p.closing_date)}")
        lines.append(f"- Next Step: {p.next_step or '—'}")
        lines.append(f"- Description / Requirements: {p.description or '—'}")
        lines.append("")

        # ── Contact ───────────────────────────────────────────────────────────
        if c:
            lines.append("## CONTACT")
            lines.append(f"- Name: {c.full_name or '—'}")
            lines.append(f"- Title: {c.title or '—'}")
            lines.append(f"- Email: {c.email or '—'}")
            lines.append(f"- Phone: {c.phone or '—'}")
            lines.append("")

        # ── Account ───────────────────────────────────────────────────────────
        if a:
            lines.append("## ACCOUNT")
            lines.append(f"- Company: {a.account_name or '—'}")
            lines.append(f"- Industry: {a.industry or '—'}")
            lines.append(f"- Website: {a.website or '—'}")
            lines.append(f"- Employees: {a.employees or '—'}")
            lines.append(f"- Revenue: ${a.annual_revenue:,.0f}" if a.annual_revenue else "- Revenue: —")
            loc = ", ".join(filter(None, [a.billing_city, a.billing_state, a.billing_country or a.country_fws]))
            lines.append(f"- Location: {loc or '—'}")
            lines.append("")

        # ── Notes ─────────────────────────────────────────────────────────────
        notes = session.execute(
            select(CXNote)
            .where(CXNote.potential_id == potential_id, CXNote.is_active == True)
            .order_by(CXNote.created_time.asc())
        ).scalars().all()

        if notes:
            lines.append("## NOTES")
            for n in notes:
                lines.append(f"[{_fmt_date(n.created_time)}] {n.content}")
            lines.append("")

        # ── Todos ─────────────────────────────────────────────────────────────
        todos = session.execute(
            select(CXTodo)
            .where(CXTodo.potential_id == potential_id, CXTodo.is_active == True)
            .order_by(CXTodo.created_time.asc())
        ).scalars().all()

        if todos:
            lines.append("## TODOS")
            for t in todos:
                check = "x" if t.is_completed else " "
                lines.append(f"- [{check}] {t.text} (status: {t.status})")
            lines.append("")

        # ── Email Conversations (sync table + Salezilla-sent, merged) ────────
        from sqlalchemy import text as _text

        # Salezilla-sent emails
        sz_emails = session.execute(
            select(CXSentEmail)
            .where(CXSentEmail.potential_id == potential_id, CXSentEmail.is_active == True)
            .order_by(CXSentEmail.sent_time.desc())
            .limit(10)
        ).scalars().all()

        # Sync table emails (includes client replies + Outlook-sent)
        pn = p.potential_number if p else None
        sync_emails = []
        if pn:
            try:
                sync_emails = session.execute(_text("""
                    SELECT TOP 15
                        [From], [To], [Subject], UniqueBody,
                        SentTime, ReceivedTime
                    FROM VW_CRM_Sales_Sync_Emails
                    WHERE PotentialNumber = :pn
                    ORDER BY COALESCE(SentTime, ReceivedTime) DESC
                """), {"pn": pn}).all()
            except Exception:
                pass  # sync table may not exist in all environments

        # Merge: deduplicate by subject+time proximity, chronological order
        seen_subjects: set[str] = set()
        all_emails: list[tuple[str, str]] = []  # (sort_key, formatted_line)

        for e in sz_emails:
            key = f"{e.subject}|{_fmt_date(e.sent_time)}"
            seen_subjects.add(key)
            body_preview = (e.body or "")[:800]
            if len(e.body or "") > 800:
                body_preview += "... [truncated]"
            sort_key = e.sent_time.isoformat() if e.sent_time else ""
            line = f"\n[{_fmt_date(e.sent_time)}] OUTBOUND — From: {e.from_name or e.from_email} → To: {e.to_name or e.to_email}\nSubject: {e.subject}\n{body_preview}"
            all_emails.append((sort_key, line))

        for row_sync in sync_emails:
            from_addr, to_addr, subject, body, sent_time, received_time = row_sync
            ts = sent_time or received_time
            key = f"{subject}|{_fmt_date(ts)}"
            if key in seen_subjects:
                continue
            seen_subjects.add(key)
            direction = "OUTBOUND" if (from_addr and any(
                from_addr.lower().endswith(d) for d in ["@flatworldsolutions.com", "@botworkflat.onmicrosoft.com"]
            )) else "INBOUND"
            body_preview = (body or "")[:800]
            if len(body or "") > 800:
                body_preview += "... [truncated]"
            sort_key = ts.isoformat() if ts else ""
            line = f"\n[{_fmt_date(ts)}] {direction} — From: {from_addr or '?'} → To: {to_addr or '?'}\nSubject: {subject or '(no subject)'}\n{body_preview}"
            all_emails.append((sort_key, line))

        all_emails.sort(key=lambda x: x[0])
        # Keep last 15
        all_emails = all_emails[-15:]

        if all_emails:
            lines.append("## EMAIL CONVERSATIONS (most recent)")
            for _, line in all_emails:
                lines.append(line)
            lines.append("")

        # ── Agent Insights ────────────────────────────────────────────────────
        insights = session.execute(
            select(CXAgentInsight, CXAgentTypeConfig)
            .join(CXAgentTypeConfig, CXAgentInsight.agent_id == CXAgentTypeConfig.agent_id)
            .where(
                CXAgentInsight.potential_id == potential_id,
                CXAgentInsight.is_active == True,
                CXAgentInsight.status == "completed",
            )
            .order_by(CXAgentTypeConfig.sort_order)
        ).all()

        if insights:
            lines.append("## AI AGENT INSIGHTS")
            for insight, cfg in insights:
                lines.append(f"\n### {cfg.agent_name} ({cfg.tab_type})")
                lines.append(insight.content or "No content")
            lines.append("")

        # ── Recent Activity (timeline) ────────────────────────────────────
        activities = session.execute(
            select(CXActivity)
            .where(CXActivity.potential_id == potential_id, CXActivity.is_active == True)
            .order_by(CXActivity.created_time.desc())
            .limit(30)
        ).scalars().all()

        if activities:
            lines.append("## RECENT ACTIVITY (latest 30)")
            for act in reversed(activities):
                ts = act.created_time.strftime("%Y-%m-%d %H:%M") if act.created_time else "—"
                lines.append(f"[{ts}] {act.activity_type}: {act.description or '—'}")
            lines.append("")

        # ── Call Logs ─────────────────────────────────────────────────────
        calls = session.execute(
            select(CXCallLog)
            .where(CXCallLog.potential_id == potential_id, CXCallLog.is_active == True)
            .order_by(CXCallLog.created_time.desc())
            .limit(10)
        ).scalars().all()

        if calls:
            lines.append("## CALL HISTORY (latest 10)")
            for call in reversed(calls):
                ts = call.created_time.strftime("%Y-%m-%d %H:%M") if call.created_time else "—"
                dur_min = call.duration // 60
                dur_sec = call.duration % 60
                dur_label = f"{dur_min}:{dur_sec:02d}" if dur_min > 0 else f"{dur_sec}s"
                lines.append(f"\n[{ts}] Call to {call.contact_name or call.phone_number} — {call.status} ({dur_label})")
                if call.notes:
                    lines.append(f"Notes: {call.notes}")
                if call.transcript:
                    transcript_preview = call.transcript[:1000]
                    if len(call.transcript) > 1000:
                        transcript_preview += "... [truncated]"
                    lines.append(f"Transcript: {transcript_preview}")
            lines.append("")

    return "\n".join(lines)


# ── Suggested questions ───────────────────────────────────────────────────────

def generate_suggestions(potential_id: str) -> list[str]:
    """Ask Claude to generate 5 context-aware questions a salesperson would ask about this potential."""
    try:
        context = build_context_prompt(potential_id)
    except Exception as e:
        logger.error("Context build failed for suggestions %s: %s", potential_id, e)
        return []

    client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY)
    prompt = (
        "Based on the potential context below, generate exactly 5 short questions that a salesperson "
        "would most likely want to ask right now — focused on the current stage, recent activity, "
        "risks, and next steps. Return only a JSON array of 5 strings, no explanation, no markdown.\n\n"
        f"{context}"
    )
    try:
        response = client.messages.create(
            model=config.ANTHROPIC_MODEL,
            max_tokens=512,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = response.content[0].text.strip()
        # Strip markdown code fences if present
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        questions = json.loads(raw)
        if isinstance(questions, list):
            return [str(q) for q in questions[:5]]
    except Exception as e:
        logger.error("Suggestion generation failed for %s: %s", potential_id, e)
    return []


# ── Streaming ─────────────────────────────────────────────────────────────────

def stream_chat(
    user_id: str,
    potential_id: str,
    user_message: str,
    history: list[ChatMessageItem],
) -> Iterator[str]:
    """
    Build context, call Claude with streaming, yield SSE chunks.
    Saves both user message and assistant response to DB.
    potential_id is the UUID; resolved to potential_number once here.
    """
    potential_number = _get_potential_number(potential_id)
    if not potential_number:
        yield f"data: {json.dumps({'type': 'error', 'message': 'Potential not found'})}\n\n"
        return

    # Save user message (pass UUID — save_message resolves internally, but we already have the number)
    # Save directly to avoid double lookup
    now = datetime.now(timezone.utc)
    with get_session() as session:
        session.add(CXChatMessage(
            user_id=user_id, potential_id=potential_number,
            role="user", content=user_message,
            created_time=now, updated_time=now, is_active=True,
        ))
        session.flush()

    # Build context system prompt
    try:
        system_prompt = build_context_prompt(potential_id)
    except Exception as e:
        logger.error("Context build failed for potential %s: %s", potential_id, e)
        system_prompt = "You are a helpful sales assistant. Context could not be loaded."

    # Build message history for Claude
    # Drop any trailing user message (dangling from a previous aborted stream)
    trimmed_history = list(history)
    while trimmed_history and trimmed_history[-1].role == "user":
        trimmed_history.pop()
    messages = [{"role": m.role, "content": m.content} for m in trimmed_history]
    messages.append({"role": "user", "content": user_message})

    client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY)

    full_response = ""
    try:
        web_search_tool = {"type": "web_search_20250305", "name": "web_search"}
        searching_notified = False

        with client.messages.stream(
            model=config.ANTHROPIC_MODEL,
            max_tokens=4096,
            system=system_prompt,
            messages=messages,
            tools=[web_search_tool],
        ) as stream:
            for event in stream:
                event_type = getattr(event, "type", None)
                # Notify UI once when web search starts
                if event_type == "content_block_start":
                    block = getattr(event, "content_block", None)
                    if block and getattr(block, "type", None) == "tool_use" and not searching_notified:
                        yield f"data: {json.dumps({'type': 'searching'})}\n\n"
                        searching_notified = True
                elif event_type == "content_block_delta":
                    delta = getattr(event, "delta", None)
                    if delta and getattr(delta, "type", None) == "text_delta":
                        text = delta.text
                        full_response += text
                        yield f"data: {json.dumps({'type': 'text', 'content': text})}\n\n"

        # Save assistant response using potential_number directly
        now2 = datetime.now(timezone.utc)
        with get_session() as session:
            msg = CXChatMessage(
                user_id=user_id, potential_id=potential_number,
                role="assistant", content=full_response,
                created_time=now2, updated_time=now2, is_active=True,
            )
            session.add(msg)
            session.flush()
            session.refresh(msg)
            yield f"data: {json.dumps({'type': 'done', 'message_id': msg.id})}\n\n"

    except Exception as e:
        logger.error("Claude streaming error for potential %s: %s", potential_id, e)
        error_msg = "Sorry, I encountered an error. Please try again."
        now3 = datetime.now(timezone.utc)
        with get_session() as session:
            session.add(CXChatMessage(
                user_id=user_id, potential_id=potential_number,
                role="assistant", content=error_msg,
                created_time=now3, updated_time=now3, is_active=True,
            ))
            session.flush()
        yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
