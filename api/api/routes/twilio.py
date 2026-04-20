"""Twilio calling endpoints — token, voice webhook, status callbacks."""

import logging

from fastapi import APIRouter, Depends, Form, Request
from fastapi.responses import Response
from pydantic import BaseModel

from core.auth import get_current_active_user
from core.models import User
from core.schemas import ResponseModel
from api.services.twilio_service import (
    build_outbound_twiml,
    create_call_log,
    generate_access_token,
    get_contacts_for_call,
    process_recording,
    update_call_status,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/twilio", tags=["twilio"])


# ── Authenticated endpoints ──────────────────────────────────────────────────

@router.post("/token")
def get_twilio_token(
    user: User = Depends(get_current_active_user),
) -> ResponseModel[dict]:
    """Generate a short-lived Twilio Access Token for the browser Voice SDK."""
    token = generate_access_token(user.user_id)
    return ResponseModel(data={"token": token, "identity": user.user_id})


@router.get("/contacts/{potential_id}")
def get_call_contacts(
    potential_id: str,
    user: User = Depends(get_current_active_user),
) -> ResponseModel[list[dict]]:
    """Get contacts available to call for a potential (primary first, then account contacts)."""
    contacts = get_contacts_for_call(potential_id)
    return ResponseModel(data=contacts)


class CreateCallLogRequest(BaseModel):
    potential_id: str
    contact_id: str | None = None
    contact_name: str | None = None
    phone_number: str
    duration: int = 0
    status: str = "completed"
    twilio_call_sid: str | None = None
    notes: str | None = None


@router.post("/call-log")
def post_call_log(
    data: CreateCallLogRequest,
    user: User = Depends(get_current_active_user),
) -> ResponseModel[dict]:
    """Create a call log entry after a call completes."""
    result = create_call_log(
        potential_id=data.potential_id,
        user_id=user.user_id,
        contact_id=data.contact_id,
        contact_name=data.contact_name,
        phone_number=data.phone_number,
        duration=data.duration,
        status=data.status,
        twilio_call_sid=data.twilio_call_sid,
        notes=data.notes,
    )
    return ResponseModel(data={
        "id": result.id,
        "status": result.status,
        "duration": result.duration,
    })


# ── Twilio webhooks (unauthenticated — called by Twilio) ─────────────────────
# In production, validate these with Twilio RequestValidator.
# For now, they are open to allow development without SSL/ngrok.

@router.post("/voice")
async def twilio_voice_webhook(request: Request):
    """Twilio calls this when the browser SDK initiates a call.

    Returns TwiML that dials the target number with recording enabled.
    """
    form = await request.form()
    to_number = form.get("To", "")
    logger.info("Twilio voice webhook: To=%s", to_number)

    if not to_number:
        twiml = "<Response><Say>No phone number provided.</Say></Response>"
    else:
        twiml = build_outbound_twiml(str(to_number))

    return Response(content=twiml, media_type="application/xml")


@router.post("/status")
async def twilio_status_webhook(request: Request):
    """Twilio sends call status updates here (ringing, in-progress, completed, etc.)."""
    form = await request.form()
    call_sid = str(form.get("CallSid", ""))
    call_status = str(form.get("CallStatus", ""))
    call_duration = form.get("CallDuration")
    logger.info("Twilio status: sid=%s status=%s duration=%s", call_sid, call_status, call_duration)

    if call_status in ("completed", "busy", "no-answer", "failed", "canceled"):
        duration = int(call_duration) if call_duration else 0
        update_call_status(call_sid, call_status, duration)

    return Response(content="<Response/>", media_type="application/xml")


@router.post("/recording-status")
async def twilio_recording_status_webhook(request: Request):
    """Twilio sends this when a recording is ready for download."""
    form = await request.form()
    all_fields = {k: str(v) for k, v in form.items()}
    call_sid = str(form.get("CallSid", ""))
    parent_call_sid = str(form.get("ParentCallSid", "")) or None
    recording_sid = str(form.get("RecordingSid", ""))
    recording_url = str(form.get("RecordingUrl", ""))
    recording_status = str(form.get("RecordingStatus", ""))
    logger.info(
        "Twilio recording webhook received: call_sid=%s parent_call_sid=%s recording_sid=%s status=%s url=%s all_fields=%s",
        call_sid, parent_call_sid, recording_sid, recording_status, recording_url, all_fields,
    )

    if recording_status == "completed" and recording_url:
        try:
            process_recording(call_sid, recording_sid, recording_url, parent_call_sid=parent_call_sid)
            logger.info("Recording processed successfully for call_sid=%s", call_sid)
        except Exception as e:
            logger.exception("Failed to process recording for call_sid=%s: %s", call_sid, e)
    else:
        logger.info("Recording not ready yet or no URL: status=%s", recording_status)

    return Response(content="<Response/>", media_type="application/xml")
