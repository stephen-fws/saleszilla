"""Twilio calling endpoints — token, voice webhook, status callbacks."""

import logging

from fastapi import APIRouter, Depends, Form, Request
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import select

import core.config as config
from core.auth import get_current_active_user
from core.database import get_session
from core.models import CXUserToken, User
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
    logger.info(
        "call-log POST: user=%s potential=%s sid=%s status=%s duration=%s",
        user.user_id, data.potential_id, data.twilio_call_sid, data.status, data.duration,
    )
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
    Caller ID resolution:
      1. Frontend may send a `FromNumber` custom param via device.connect()
         to indicate which number the user picked from the dropdown.
      2. We validate it against the user's saved twilio_number AND the org
         default — anything else is rejected (security: don't trust the
         client to spoof caller IDs).
      3. If no valid pick, fall back to the user's saved number, then the
         org default.
    """
    form = await request.form()
    to_number = form.get("To", "")
    from_param = str(form.get("FromNumber", "")).strip()
    # Twilio sends `From=client:<identity>` for browser-SDK-initiated calls.
    from_field = str(form.get("From", "")).strip()
    identity = from_field[len("client:"):] if from_field.startswith("client:") else ""
    logger.info("Twilio voice webhook: To=%s FromNumber=%s identity=%s", to_number, from_param, identity)

    if not to_number:
        twiml = "<Response><Say>No phone number provided.</Say></Response>"
        return Response(content=twiml, media_type="application/xml")

    # Resolve caller ID against the user's settings.
    user_twilio_number: str | None = None
    if identity:
        with get_session() as session:
            row = session.execute(
                select(CXUserToken).where(
                    CXUserToken.user_id == identity,
                    CXUserToken.is_active == True,
                ).limit(1)
            ).scalar_one_or_none()
            user_twilio_number = row.twilio_number if row else None

    allowed = {n for n in (user_twilio_number, config.TWILIO_CALLING_NUMBER) if n}
    if from_param and from_param in allowed:
        caller_id = from_param
    elif user_twilio_number:
        caller_id = user_twilio_number
    else:
        caller_id = None  # build_outbound_twiml falls back to org default

    twiml = build_outbound_twiml(str(to_number), caller_id=caller_id)
    logger.info("Twilio voice TwiML response (caller_id=%s): %s", caller_id, twiml)
    return Response(content=twiml, media_type="application/xml")


@router.post("/status")
async def twilio_status_webhook(request: Request):
    """Twilio call status updates.

    Two leg sources:
      - PARENT leg (browser→Twilio) — `CallSid` matches the SID we stored
        when the call was initiated. Status `in-progress` for the parent
        fires when the SDK accepts the call (before the remote phone is
        actually picked up), so we IGNORE non-terminal parent events.
      - CHILD leg (Twilio→destination) — `ParentCallSid` matches our
        stored SID. Status `in-progress` for the child fires when the
        destination phone is picked up — the authoritative answer signal
        the dialog poll is waiting for.
    """
    form = await request.form()
    call_sid = str(form.get("CallSid", ""))
    parent_call_sid = str(form.get("ParentCallSid", ""))
    call_status = str(form.get("CallStatus", ""))
    call_duration = form.get("CallDuration")
    logger.info(
        "Twilio status: sid=%s parent=%s status=%s duration=%s",
        call_sid, parent_call_sid, call_status, call_duration,
    )

    duration = int(call_duration) if call_duration else 0
    is_terminal = call_status in ("completed", "busy", "no-answer", "failed", "canceled")

    if parent_call_sid:
        # Child-leg event — authoritative for ALL statuses (including
        # the in-progress that means "callee picked up").
        update_call_status(parent_call_sid, call_status, duration)
    elif is_terminal:
        # Parent-leg terminal — also useful (e.g. browser disconnects).
        update_call_status(call_sid, call_status, duration)
    # else: parent-leg non-terminal — ignored (would lie about answer time).

    return Response(content="<Response/>", media_type="application/xml")


@router.get("/calls/{call_sid}/status")
def get_call_status(
    call_sid: str,
    user: User = Depends(get_current_active_user),
) -> ResponseModel[dict]:
    """Return the current Twilio CallStatus for a given SID.
    Used by the in-call dialog to learn when the callee actually picked up
    so the duration timer starts at the right moment."""
    from core.database import get_session
    from core.models import CXCallLog
    from sqlalchemy import select
    with get_session() as session:
        log = session.execute(
            select(CXCallLog).where(
                CXCallLog.twilio_call_sid == call_sid,
                CXCallLog.is_active == True,
            ).limit(1)
        ).scalar_one_or_none()
    if not log:
        return ResponseModel(data={"status": None})
    return ResponseModel(data={"status": log.status, "duration": log.duration or 0})


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
