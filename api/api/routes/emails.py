"""Email draft and send endpoints."""

from fastapi import APIRouter, Body, Depends
from typing import Optional

from core.auth import get_current_active_user
from core.exceptions import BotApiException
from core.models import User
from core.ms_graph import get_valid_ms_token, send_mail_via_graph
from core.schemas import (
    CreateDraftRequest, UpdateDraftRequest, UserEmailDraftItem,
    DraftAttachmentItem, EmailDraftResponse, EmailThreadsResponse, ResponseModel,
    SendEmailRequest, SentEmailResponse, SignatureRequest, UserSettingsResponse,
    UserSettingsUpdateRequest,
)
from api.services.email_service import get_email_draft, record_sent_email
from api.services.user_draft_service import (
    list_drafts, create_draft, update_draft, delete_draft,
    mark_draft_sent, get_signature, save_signature,
)
from api.services.user_settings_service import (
    get_settings as get_user_settings,
    update_settings as update_user_settings,
)
from api.services.access_control import require_potential_owner
from api.services.user_service import load_user_tokens
from api.services.email_thread_service import get_email_threads
from api.services.activity_service import log_activity
from api.services.draft_attachment_service import (
    list_active as list_draft_attachments,
    mark_removed as remove_draft_attachment,
    load_for_send as load_draft_attachments_for_send,
    mark_sent as mark_draft_attachments_sent,
    get_content as get_draft_attachment_content,
)

router = APIRouter(tags=["emails"])


# ── User email draft CRUD ─────────────────────────────────────────────────────

@router.get("/potentials/{potential_id}/drafts")
def get_drafts(
    potential_id: str,
    is_next_action: bool = False,
    user: User = Depends(get_current_active_user),
) -> ResponseModel[list[UserEmailDraftItem]]:
    require_potential_owner(user.user_id, potential_id)
    return ResponseModel(data=list_drafts(potential_id, user.user_id, is_next_action=is_next_action))


@router.post("/potentials/{potential_id}/drafts")
def post_draft(
    potential_id: str,
    is_next_action: bool = False,
    data: CreateDraftRequest = Body(),
    user: User = Depends(get_current_active_user),
) -> ResponseModel[UserEmailDraftItem]:
    require_potential_owner(user.user_id, potential_id)
    return ResponseModel(data=create_draft(potential_id, data, user.user_id, is_next_action=is_next_action))


@router.patch("/potentials/{potential_id}/drafts/{draft_id}")
def patch_draft(
    potential_id: str,
    draft_id: int,
    data: UpdateDraftRequest = Body(),
    user: User = Depends(get_current_active_user),
) -> ResponseModel[UserEmailDraftItem]:
    require_potential_owner(user.user_id, potential_id)
    result = update_draft(draft_id, data, user.user_id)
    if not result:
        raise BotApiException(404, "ERR_NOT_FOUND", "Draft not found.")
    return ResponseModel(data=result)


@router.delete("/potentials/{potential_id}/drafts/{draft_id}")
def remove_draft(
    potential_id: str,
    draft_id: int,
    user: User = Depends(get_current_active_user),
) -> ResponseModel[dict]:
    require_potential_owner(user.user_id, potential_id)
    if not delete_draft(draft_id, user.user_id):
        raise BotApiException(404, "ERR_NOT_FOUND", "Draft not found.")
    return ResponseModel(data={"ok": True})


# ── Signature ─────────────────────────────────────────────────────────────────

@router.get("/me/email-signature")
def get_user_signature(
    user: User = Depends(get_current_active_user),
) -> ResponseModel[dict]:
    sig = get_signature(user.user_id)
    return ResponseModel(data={"signature": sig})


@router.patch("/me/email-signature")
def update_user_signature(
    data: SignatureRequest = Body(),
    user: User = Depends(get_current_active_user),
) -> ResponseModel[dict]:
    save_signature(user.user_id, data.signature)
    return ResponseModel(data={"ok": True})


# ── User settings (signature + working hours + timezone) ─────────────────────

@router.get("/me/settings")
def get_me_settings(
    user: User = Depends(get_current_active_user),
) -> ResponseModel[UserSettingsResponse]:
    return ResponseModel(data=get_user_settings(user.user_id))


@router.patch("/me/settings")
def patch_me_settings(
    data: UserSettingsUpdateRequest = Body(),
    user: User = Depends(get_current_active_user),
) -> ResponseModel[UserSettingsResponse]:
    try:
        updated = update_user_settings(user.user_id, data)
    except ValueError as exc:
        from core.exceptions import BotApiException
        raise BotApiException(400, "ERR_INVALID_SETTINGS", str(exc))
    return ResponseModel(data=updated)


# ── Send email ────────────────────────────────────────────────────────────────

@router.post("/potentials/{potential_id}/send-email")
async def send_email(
    potential_id: str,
    data: SendEmailRequest = Body(),
    user: User = Depends(get_current_active_user),
) -> ResponseModel[SentEmailResponse]:
    require_potential_owner(user.user_id, potential_id)
    ms_token = await get_valid_ms_token(user.user_id)
    tokens = load_user_tokens(user.user_id)
    from_email = tokens.ms_email or user.email if tokens else user.email

    # Convert manual attachments to Graph format
    manual_payload = []
    if data.attachments:
        manual_payload = [
            {"name": a.name, "content_type": a.content_type, "content_bytes": a.content_bytes}
            for a in data.attachments
        ]

    # Merge in agent-generated draft attachments (if any requested). Server loads
    # the bytes from GCS authoritatively — client sends only ids.
    draft_att_loaded: list[dict] = []
    if data.draft_attachment_ids:
        from core.database import get_session
        from core.models import Potential
        from sqlalchemy import select
        with get_session() as _s:
            pn = _s.execute(
                select(Potential.potential_number).where(Potential.potential_id == potential_id)
            ).scalar_one_or_none()
        if pn:
            all_loaded = load_draft_attachments_for_send(pn)
            # Only include the ids the client actually asked for
            requested = set(data.draft_attachment_ids)
            draft_att_loaded = [a for a in all_loaded if a["id"] in requested]

    draft_payload = [
        {"name": a["name"], "content_type": a["content_type"], "content_bytes": a["content_bytes"]}
        for a in draft_att_loaded
    ]
    attachments_payload = (manual_payload + draft_payload) or None

    try:
        message_id, thread_id, internet_message_id = await send_mail_via_graph(
            access_token=ms_token,
            to_address=data.to_email,
            subject=data.subject,
            body_html=data.body,
            cc_addresses=data.cc,
            bcc_addresses=data.bcc,
            attachments=attachments_payload,
            thread_id=data.thread_id,
            reply_to_message_id=data.reply_to_message_id,
        )
    except Exception as exc:
        raise BotApiException(424, "ERR_EMAIL_SEND_FAILED", f"Failed to send email: {exc}")

    # Mark draft attachments as sent only after successful Graph send
    if draft_att_loaded:
        mark_draft_attachments_sent([a["id"] for a in draft_att_loaded])

    result = record_sent_email(
        potential_id=potential_id,
        from_email=from_email,
        from_name=user.name,
        to_email=data.to_email,
        to_name=data.to_name,
        cc_emails=", ".join(data.cc) if data.cc else None,
        bcc_emails=", ".join(data.bcc) if data.bcc else None,
        subject=data.subject,
        body=data.body,
        thread_id=thread_id,
        internet_message_id=internet_message_id,
        draft_id=None,
        user_id=user.user_id,
    )

    # Mark user draft as sent if provided
    if data.draft_id:
        mark_draft_sent(data.draft_id)

    # Proactively start the follow-up series — don't wait for the email sync
    # service to echo this back. The idempotency check in start_new_series
    # will absorb the later sync-service webhook harmlessly.
    if internet_message_id:
        try:
            from datetime import datetime, timezone
            from api.services.follow_up_service import OutboundEvent, start_new_series
            from core.models import Potential
            from core.database import get_session
            from sqlalchemy import select
            with get_session() as _s:
                pn = _s.execute(
                    select(Potential.potential_number).where(Potential.potential_id == potential_id)
                ).scalar_one_or_none()
            if pn:
                start_new_series(OutboundEvent(
                    potential_number=pn,
                    internet_message_id=internet_message_id,
                    sent_time=datetime.now(timezone.utc),
                    from_email=from_email,
                    to_email=data.to_email,
                    subject=data.subject,
                ))
                # NOTE: intentionally NOT triggering todo_reconcile here. The sync
                # service will fire /webhooks/email-outbound for this same email
                # shortly — that path calls trigger_todo_reconcile. Firing both
                # would double the agent runs for every Salezilla-sent email.
        except Exception:
            # Non-fatal — sync service will re-trigger later
            import logging
            logging.getLogger(__name__).exception("follow_up: proactive start failed for potential=%s", potential_id)

    # Activity is already logged inside email_service.send_email()
    return ResponseModel(message_code="MSG_EMAIL_SENT", data=result)


# ── Draft attachments (agent-generated HTML, attached to NextAction draft) ──

@router.get("/potentials/{potential_id}/draft-attachments")
def list_active_draft_attachments(
    potential_id: str,
    user: User = Depends(get_current_active_user),
) -> ResponseModel[list[DraftAttachmentItem]]:
    """Return active (not removed, not sent) draft attachments for this potential."""
    require_potential_owner(user.user_id, potential_id)
    from core.database import get_session
    from core.models import Potential
    from sqlalchemy import select
    with get_session() as _s:
        pn = _s.execute(
            select(Potential.potential_number).where(Potential.potential_id == potential_id)
        ).scalar_one_or_none() or potential_id
    rows = list_draft_attachments(pn)
    return ResponseModel(data=[DraftAttachmentItem(**r) for r in rows])


@router.delete("/potentials/{potential_id}/draft-attachments/{attachment_id}")
def remove_draft_attachment_endpoint(
    potential_id: str,
    attachment_id: int,
    user: User = Depends(get_current_active_user),
) -> ResponseModel[dict]:
    """Soft-remove a draft attachment (user clicked X in composer)."""
    require_potential_owner(user.user_id, potential_id)
    from core.database import get_session
    from core.models import Potential
    from sqlalchemy import select
    with get_session() as _s:
        pn = _s.execute(
            select(Potential.potential_number).where(Potential.potential_id == potential_id)
        ).scalar_one_or_none() or potential_id
    ok = remove_draft_attachment(attachment_id, pn)
    if not ok:
        raise BotApiException(404, "ERR_ATTACHMENT_NOT_FOUND", "Attachment not found for this potential.")
    return ResponseModel(data={"ok": True})


@router.get("/potentials/{potential_id}/draft-attachments/{attachment_id}/download")
def download_draft_attachment(
    potential_id: str,
    attachment_id: int,
    user: User = Depends(get_current_active_user),
):
    """Proxy-download a draft attachment's HTML content from GCS.

    Returns inline so the browser renders the HTML instead of downloading it,
    since the whole point of the attachment is for the user to preview it.
    """
    require_potential_owner(user.user_id, potential_id)
    from core.database import get_session
    from core.models import Potential
    from sqlalchemy import select
    from fastapi.responses import Response
    with get_session() as _s:
        pn = _s.execute(
            select(Potential.potential_number).where(Potential.potential_id == potential_id)
        ).scalar_one_or_none() or potential_id
    result = get_draft_attachment_content(attachment_id, pn)
    if not result:
        raise BotApiException(404, "ERR_ATTACHMENT_NOT_FOUND", "Attachment not found or missing in storage.")
    content, filename, content_type = result
    return Response(
        content=content,
        media_type=content_type,
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


# ── Next Action resolve (skip / done) ────────────────────────────────────────

# trigger_category → queue folder (1:1). Used when resolve_next_action is
# scoped to a specific category (e.g., user clicked Skip while viewing the
# Reply folder's Next Action — only the reply insight + reply QI should close).
_CATEGORY_FOLDER = {
    "newEnquiry":       "new-inquiries",
    "followUp":         "follow-up-active",
    "followUpInactive": "follow-up-inactive",
    "reply":            "reply",
    "meeting_brief":    "meeting-briefs",
    "news":             "news",
}


@router.post("/potentials/{potential_id}/next-action/resolve")
def resolve_next_action(
    potential_id: str,
    action: str = "done",
    category: str | None = None,
    user: User = Depends(get_current_active_user),
) -> ResponseModel[dict]:
    """Mark next_action insights as actioned. Called when user clicks Skip or
    Done on the Next Action tab, or when the composer auto-completes on send.

    `category` scopes the resolution to a single trigger_category so meeting_brief
    and other next_actions coexist cleanly: Skip on the Reply view only closes
    the reply insight + reply QI; the meeting_brief insight + meeting-briefs QI
    stay live. If `category` is omitted, falls back to the legacy "resolve all
    next_actions + all managed folder QIs" behavior.
    """
    require_potential_owner(user.user_id, potential_id)
    from core.database import get_session
    from core.models import CXAgentInsight, CXAgentTypeConfig, CXQueueItem, CXUserEmailDraft, Potential
    from sqlalchemy import select
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    with get_session() as session:
        pn = session.execute(
            select(Potential.potential_number).where(Potential.potential_id == potential_id)
        ).scalar_one_or_none() or potential_id

        # Snapshot + mark next_action insights as actioned (scoped to category if set)
        from core.models import CXAgentDraftHistory
        insight_filter = [
            CXAgentInsight.potential_id == pn,
            CXAgentTypeConfig.tab_type == "next_action",
            CXAgentInsight.status.notin_(("actioned", "skipped")),
            CXAgentInsight.is_active == True,
        ]
        if category:
            insight_filter.append(CXAgentTypeConfig.trigger_category == category)

        rows = session.execute(
            select(CXAgentInsight)
            .join(CXAgentTypeConfig, CXAgentInsight.agent_id == CXAgentTypeConfig.agent_id)
            .where(*insight_filter)
        ).scalars().all()
        for r in rows:
            # Snapshot before resolving
            if r.content:
                session.add(CXAgentDraftHistory(
                    potential_id=r.potential_id,
                    agent_id=r.agent_id,
                    agent_name=r.agent_name,
                    trigger_category=r.agent_type,
                    content=r.content,
                    status=r.status,
                    resolution=action,
                    triggered_at=r.triggered_at,
                    completed_at=r.completed_time,
                    resolved_at=now,
                    created_time=now,
                ))
            r.status = "actioned"
            r.updated_time = now
            session.add(r)

        # Soft-delete any next_action drafts (potential-scoped; no category key on drafts)
        na_drafts = session.execute(
            select(CXUserEmailDraft).where(
                CXUserEmailDraft.potential_id == potential_id,
                CXUserEmailDraft.is_next_action == True,
                CXUserEmailDraft.status == "draft",
                CXUserEmailDraft.is_active == True,
            )
        ).scalars().all()
        for d in na_drafts:
            d.is_active = False
            d.updated_time = now
            session.add(d)

        # Close the matching queue item(s). If category is set: just the one
        # folder. Otherwise: all managed folders (legacy behavior).
        if category:
            target_folders = [f for f in [_CATEGORY_FOLDER.get(category)] if f]
        else:
            target_folders = [
                "follow-up-active", "follow-up-inactive", "new-inquiries",
                "reply", "meeting-briefs", "news",
            ]
        for folder in target_folders:
            qi = session.execute(
                select(CXQueueItem).where(
                    CXQueueItem.potential_id == pn,
                    CXQueueItem.folder_type == folder,
                    CXQueueItem.status == "pending",
                    CXQueueItem.is_active == True,
                )
            ).scalar_one_or_none()
            if qi:
                qi.status = "completed"
                qi.updated_time = now
                session.add(qi)

    return ResponseModel(data={"ok": True, "action": action, "category": category, "resolved": len(rows)})


# ── Attachment download (proxy through backend) ─────────────────────────────

@router.get("/potentials/{potential_id}/email-attachment")
async def download_email_attachment(
    potential_id: str,
    message_id: str,
    attachment_id: str,
    user: User = Depends(get_current_active_user),
):
    """Proxy-download an email attachment from MS Graph."""
    require_potential_owner(user.user_id, potential_id)
    from core.database import get_session
    from core.models import Potential
    from sqlalchemy import select
    from fastapi.responses import Response
    import requests as req

    with get_session() as session:
        owner_id = session.execute(
            select(Potential.potential_owner_id).where(Potential.potential_id == potential_id)
        ).scalar_one_or_none()

    if not owner_id:
        raise BotApiException(404, "ERR_NOT_FOUND", "Potential not found.")

    ms_token = await get_valid_ms_token(owner_id)
    url = f"https://graph.microsoft.com/v1.0/me/messages/{message_id}/attachments/{attachment_id}"
    resp = req.get(url, headers={"Authorization": f"Bearer {ms_token}"}, timeout=30)
    if resp.status_code != 200:
        raise BotApiException(resp.status_code, "ERR_ATTACHMENT_FETCH", "Failed to fetch attachment.")

    data = resp.json()
    import base64
    content_bytes = base64.b64decode(data.get("contentBytes", ""))
    filename = data.get("name", "attachment")
    content_type = data.get("contentType", "application/octet-stream")

    return Response(
        content=content_bytes,
        media_type=content_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── Meeting info (for meeting brief next action) ─────────────────────────────

@router.get("/potentials/{potential_id}/meeting-info")
def get_meeting_info(
    potential_id: str,
    user: User = Depends(get_current_active_user),
) -> ResponseModel[dict]:
    """Return the most recent meeting from CX_Meetings for this potential."""
    require_potential_owner(user.user_id, potential_id)
    from core.database import get_session
    from core.models import CXMeeting
    from sqlalchemy import select
    import json as _json
    with get_session() as session:
        row = session.execute(
            select(CXMeeting).where(
                CXMeeting.potential_id == potential_id,
                CXMeeting.is_active == True,
            ).order_by(CXMeeting.start_time.desc()).limit(1)
        ).scalar_one_or_none()
    if not row:
        return ResponseModel(data=None)
    attendees = []
    if row.attendees:
        try:
            attendees = _json.loads(row.attendees)
        except Exception:
            attendees = [row.attendees]
    return ResponseModel(data={
        "title": row.title,
        "start_time": row.start_time.isoformat() if row.start_time else None,
        "end_time": row.end_time.isoformat() if row.end_time else None,
        "location": row.location,
        "description": row.description,
        "meeting_link": row.meeting_link,
        "attendees": attendees,
        "ms_event_id": row.ms_event_id,
    })


# ── Reply context (latest thread info for composing replies) ─────────────────

@router.get("/potentials/{potential_id}/reply-context")
def get_reply_context(
    potential_id: str,
    user: User = Depends(get_current_active_user),
) -> ResponseModel[dict]:
    """Return the thread_id + internet_message_id for composing a threaded reply.

    Priority:
      1. Active follow-up schedule → use its trigger_message_id to find the
         exact CX_SentEmails row → return that row's thread_id. This ensures
         the follow-up replies to the specific thread that started the series.
      2. Fallback → most recent CX_SentEmails row with a thread_id.
    """
    require_potential_owner(user.user_id, potential_id)
    from core.database import get_session
    from core.models import CXSentEmail, CXFollowUpSchedule, Potential
    from sqlalchemy import select

    with get_session() as session:
        # Try to anchor on the active FU schedule's trigger email
        pn = session.execute(
            select(Potential.potential_number).where(Potential.potential_id == potential_id)
        ).scalar_one_or_none()

        if pn:
            # Find the most recently FIRED schedule — that's the one whose FU
            # agent result is currently showing in Next Action. Pending schedules
            # from newer emails (e.g. a manual compose from Email tab) are excluded.
            schedule = session.execute(
                select(CXFollowUpSchedule).where(
                    CXFollowUpSchedule.potential_number == pn,
                    CXFollowUpSchedule.trigger_message_id.is_not(None),
                    CXFollowUpSchedule.status == "fired",
                ).order_by(CXFollowUpSchedule.fired_time.desc()).limit(1)
            ).scalar_one_or_none()

            if schedule and schedule.trigger_message_id:
                sent_row = session.execute(
                    select(CXSentEmail).where(
                        CXSentEmail.potential_id == potential_id,
                        CXSentEmail.internet_message_id == schedule.trigger_message_id,
                        CXSentEmail.is_active == True,
                    )
                ).scalar_one_or_none()
                if sent_row and sent_row.thread_id:
                    return ResponseModel(data={
                        "thread_id": sent_row.thread_id,
                        "internet_message_id": sent_row.internet_message_id,
                    })

        # Fallback: most recent sent email with a thread_id
        fallback = session.execute(
            select(CXSentEmail).where(
                CXSentEmail.potential_id == potential_id,
                CXSentEmail.is_active == True,
                CXSentEmail.thread_id.is_not(None),
            ).order_by(CXSentEmail.sent_time.desc()).limit(1)
        ).scalar_one_or_none()

    if not fallback:
        return ResponseModel(data={"thread_id": None, "internet_message_id": None})
    return ResponseModel(data={
        "thread_id": fallback.thread_id,
        "internet_message_id": fallback.internet_message_id,
    })


# ── Email threads (from sync table) ──────────────────────────────────────────

@router.get("/potentials/{potential_id}/email-threads")
def get_potential_email_threads(
    potential_id: str,
    user: User = Depends(get_current_active_user),
) -> ResponseModel[EmailThreadsResponse]:
    require_potential_owner(user.user_id, potential_id)
    from core.database import get_session
    from core.models import Potential
    from sqlalchemy import select
    with get_session() as session:
        pn = session.execute(
            select(Potential.potential_number).where(Potential.potential_id == potential_id)
        ).scalar_one_or_none()
    if not pn:
        return ResponseModel(data=EmailThreadsResponse(threads=[], total_messages=0))
    return ResponseModel(data=get_email_threads(potential_id, pn))


# ── Legacy endpoint ───────────────────────────────────────────────────────────

@router.get("/potentials/{potential_id}/email-draft")
def get_draft_legacy(
    potential_id: str,
    user: User = Depends(get_current_active_user),
) -> ResponseModel[EmailDraftResponse | None]:
    require_potential_owner(user.user_id, potential_id)
    draft = get_email_draft(potential_id)
    return ResponseModel(data=draft)
