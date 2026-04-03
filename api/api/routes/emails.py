"""Email draft and send endpoints."""

from fastapi import APIRouter, Body, Depends

from core.auth import get_current_active_user
from core.exceptions import BotApiException
from core.models import User
from core.ms_graph import get_valid_ms_token, send_mail_via_graph
from core.schemas import EmailDraftResponse, ResponseModel, SendEmailRequest, SentEmailResponse
from api.services.email_service import get_email_draft, record_sent_email
from api.services.user_service import load_user_tokens
from api.services.activity_service import log_activity

router = APIRouter(prefix="/potentials/{potential_id}", tags=["emails"])


@router.get("/email-draft")
def get_draft(
    potential_id: str,
    user: User = Depends(get_current_active_user),
) -> ResponseModel[EmailDraftResponse | None]:
    draft = get_email_draft(potential_id)
    return ResponseModel(data=draft)


@router.post("/send-email")
async def send_email(
    potential_id: str,
    data: SendEmailRequest = Body(),
    user: User = Depends(get_current_active_user),
) -> ResponseModel[SentEmailResponse]:
    # Get valid MS token (refreshes if needed)
    ms_token = await get_valid_ms_token(user.user_id)

    tokens = load_user_tokens(user.user_id)
    from_email = tokens.ms_email or user.email if tokens else user.email

    # Send via MS Graph
    try:
        message_id, thread_id = await send_mail_via_graph(
            access_token=ms_token,
            to_address=data.to_email,
            subject=data.subject,
            body_html=data.body,
            cc_addresses=data.cc,
            bcc_addresses=data.bcc,
            thread_id=data.thread_id,
            reply_to_message_id=data.reply_to_message_id,
        )
    except Exception as exc:
        raise BotApiException(424, "ERR_EMAIL_SEND_FAILED", f"Failed to send email: {exc}")

    # Record in DB
    result = record_sent_email(
        potential_id=potential_id,
        from_email=from_email,
        from_name=user.name,
        to_email=data.to_email,
        to_name=data.to_name,
        subject=data.subject,
        body=data.body,
        thread_id=thread_id,
        draft_id=data.draft_id,
        user_id=user.user_id,
    )

    log_activity(
        potential_id=potential_id,
        activity_type="email_sent",
        description=f"Email sent to {data.to_email}: \"{data.subject}\"",
        user_id=user.user_id,
    )
    return ResponseModel(message_code="MSG_EMAIL_SENT", data=result)
