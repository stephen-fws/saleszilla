"""Email draft and send endpoints."""

from fastapi import APIRouter, Body, Depends
from typing import Optional

from core.auth import get_current_active_user
from core.exceptions import BotApiException
from core.models import User
from core.ms_graph import get_valid_ms_token, send_mail_via_graph
from core.schemas import (
    CreateDraftRequest, UpdateDraftRequest, UserEmailDraftItem,
    EmailDraftResponse, ResponseModel, SendEmailRequest, SentEmailResponse,
    SignatureRequest,
)
from api.services.email_service import get_email_draft, record_sent_email
from api.services.user_draft_service import (
    list_drafts, create_draft, update_draft, delete_draft,
    mark_draft_sent, get_signature, save_signature,
)
from api.services.user_service import load_user_tokens
from api.services.activity_service import log_activity

router = APIRouter(tags=["emails"])


# ── User email draft CRUD ─────────────────────────────────────────────────────

@router.get("/potentials/{potential_id}/drafts")
def get_drafts(
    potential_id: str,
    user: User = Depends(get_current_active_user),
) -> ResponseModel[list[UserEmailDraftItem]]:
    return ResponseModel(data=list_drafts(potential_id, user.user_id))


@router.post("/potentials/{potential_id}/drafts")
def post_draft(
    potential_id: str,
    data: CreateDraftRequest = Body(),
    user: User = Depends(get_current_active_user),
) -> ResponseModel[UserEmailDraftItem]:
    return ResponseModel(data=create_draft(potential_id, data, user.user_id))


@router.patch("/potentials/{potential_id}/drafts/{draft_id}")
def patch_draft(
    potential_id: str,
    draft_id: int,
    data: UpdateDraftRequest = Body(),
    user: User = Depends(get_current_active_user),
) -> ResponseModel[UserEmailDraftItem]:
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


# ── Send email ────────────────────────────────────────────────────────────────

@router.post("/potentials/{potential_id}/send-email")
async def send_email(
    potential_id: str,
    data: SendEmailRequest = Body(),
    user: User = Depends(get_current_active_user),
) -> ResponseModel[SentEmailResponse]:
    ms_token = await get_valid_ms_token(user.user_id)
    tokens = load_user_tokens(user.user_id)
    from_email = tokens.ms_email or user.email if tokens else user.email

    # Convert attachments to Graph format
    attachments_payload = None
    if data.attachments:
        attachments_payload = [
            {"name": a.name, "content_type": a.content_type, "content_bytes": a.content_bytes}
            for a in data.attachments
        ]

    try:
        message_id, thread_id = await send_mail_via_graph(
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

    result = record_sent_email(
        potential_id=potential_id,
        from_email=from_email,
        from_name=user.name,
        to_email=data.to_email,
        to_name=data.to_name,
        subject=data.subject,
        body=data.body,
        thread_id=thread_id,
        draft_id=None,
        user_id=user.user_id,
    )

    # Mark user draft as sent if provided
    if data.draft_id:
        mark_draft_sent(data.draft_id)

    log_activity(
        potential_id=potential_id,
        activity_type="email_sent",
        description=f"Email sent to {data.to_email}: \"{data.subject}\"",
        user_id=user.user_id,
    )
    return ResponseModel(message_code="MSG_EMAIL_SENT", data=result)


# ── Legacy endpoint ───────────────────────────────────────────────────────────

@router.get("/potentials/{potential_id}/email-draft")
def get_draft_legacy(
    potential_id: str,
    user: User = Depends(get_current_active_user),
) -> ResponseModel[EmailDraftResponse | None]:
    draft = get_email_draft(potential_id)
    return ResponseModel(data=draft)
