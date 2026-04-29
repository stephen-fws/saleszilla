"""Twilio service — browser-based calling via Twilio Client SDK (WebRTC).

Token generation, TwiML building, recording/transcript retrieval,
and post-call enrichment (GCS upload + call log update + activity log).
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

import httpx
from sqlalchemy import select
from twilio.jwt.access_token import AccessToken
from twilio.jwt.access_token.grants import VoiceGrant
from twilio.rest import Client as TwilioClient
from twilio.twiml.voice_response import VoiceResponse

import core.config as config
from core.database import get_session
from core.models import Account, Contact, CXActivity, CXCallLog, CXFile, Potential
from core.schemas import CallLogItem

logger = logging.getLogger(__name__)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _twilio_client() -> TwilioClient:
    return TwilioClient(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN)


# ── Token generation ─────────────────────────────────────────────────────────

def generate_access_token(user_id: str) -> str:
    """Generate a short-lived Twilio Access Token with a VoiceGrant.

    The browser's Twilio Voice SDK uses this to register as a device and
    make/receive calls.
    """
    token = AccessToken(
        config.TWILIO_ACCOUNT_SID,
        config.TWILIO_API_KEY,
        config.TWILIO_API_SECRET,
        identity=user_id,
        ttl=3600,  # 1 hour
    )
    voice_grant = VoiceGrant(
        outgoing_application_sid=config.TWILIO_TWIML_APP_SID,
        incoming_allow=False,  # we only do outbound for now
    )
    token.add_grant(voice_grant)
    return token.to_jwt()


# ── TwiML generation ─────────────────────────────────────────────────────────

def build_outbound_twiml(to_number: str) -> str:
    """Build TwiML XML that Twilio executes when the browser SDK connects.

    Dials the target number from our Twilio number, records the full call
    (dual-channel for transcript quality), and sets a status callback.
    """
    response = VoiceResponse()
    dial = response.dial(
        caller_id=config.TWILIO_CALLING_NUMBER,
        record="record-from-answer-dual",
        recording_status_callback=f"{config.BASE_URL}/twilio/recording-status",
        recording_status_callback_method="POST",
    )
    dial.number(to_number)
    return str(response)


# ── Contacts for calling ─────────────────────────────────────────────────────

def get_contacts_for_call(potential_id: str) -> list[dict[str, Any]]:
    """Return contacts available to call for a potential.

    Returns the primary contact (from Potential.contact_id) first, then
    other contacts on the same account. Each includes phone/mobile/name/title.
    """
    with get_session() as session:
        pot = session.execute(
            select(Potential).where(Potential.potential_id == potential_id)
        ).scalar_one_or_none()
        if not pot:
            return []

        contact_ids_seen: set[str] = set()
        contacts: list[dict[str, Any]] = []

        # Primary contact
        if pot.contact_id:
            primary = session.execute(
                select(Contact).where(Contact.contact_id == pot.contact_id)
            ).scalar_one_or_none()
            if primary and (primary.phone or primary.mobile):
                contacts.append({
                    "contact_id": primary.contact_id,
                    "name": primary.full_name or f"{primary.first_name or ''} {primary.last_name or ''}".strip() or "Unknown",
                    "title": primary.title,
                    "email": primary.email,
                    "phone": primary.phone,
                    "mobile": primary.mobile,
                    "is_primary": True,
                })
                contact_ids_seen.add(primary.contact_id)

        # Other contacts on the same account
        if pot.account_id:
            others = session.execute(
                select(Contact).where(
                    Contact.account_id == pot.account_id,
                    Contact.contact_id.notin_(contact_ids_seen) if contact_ids_seen else True,
                ).order_by(Contact.full_name)
            ).scalars().all()
            for c in others:
                if c.contact_id in contact_ids_seen:
                    continue
                if not c.phone and not c.mobile:
                    continue
                contacts.append({
                    "contact_id": c.contact_id,
                    "name": c.full_name or f"{c.first_name or ''} {c.last_name or ''}".strip() or "Unknown",
                    "title": c.title,
                    "email": c.email,
                    "phone": c.phone,
                    "mobile": c.mobile,
                    "is_primary": False,
                })
                contact_ids_seen.add(c.contact_id)

    return contacts


# ── Call log management ──────────────────────────────────────────────────────

def create_call_log(
    potential_id: str,
    user_id: str,
    contact_id: str | None,
    contact_name: str | None,
    phone_number: str,
    duration: int,
    status: str,
    twilio_call_sid: str | None,
    notes: str | None = None,
) -> CallLogItem:
    """Create or update a call log entry and log the activity for timeline.

    Called twice per call:
      1. At call START (status="in-progress", duration=0, no notes) — creates the row
         so the recording webhook can find it by twilio_call_sid.
      2. At "Save & Close" (status="completed", final duration, notes) — updates the
         existing row if it exists (matched by twilio_call_sid), or creates a new one.

    The timeline activity is only logged on the FINAL save (status != "in-progress")
    to avoid a duplicate "Call logged" entry.
    """
    now = datetime.now(timezone.utc)

    # Resolve account_id from potential
    with get_session() as session:
        account_id = session.execute(
            select(Potential.account_id).where(Potential.potential_id == potential_id)
        ).scalar_one_or_none()

    # Upsert call log — check for existing row by twilio_call_sid
    with get_session() as session:
        existing = None
        if twilio_call_sid:
            existing = session.execute(
                select(CXCallLog).where(
                    CXCallLog.twilio_call_sid == twilio_call_sid,
                    CXCallLog.is_active == True,
                )
            ).scalar_one_or_none()

        if existing:
            # Update existing row (created at call start, now finalizing)
            existing.duration = duration
            existing.status = status
            existing.notes = notes
            existing.updated_time = now
            session.add(existing)
            session.flush()
            session.refresh(existing)
            call_id = existing.id
        else:
            # Create new row
            log = CXCallLog(
                potential_id=potential_id,
                contact_id=contact_id,
                account_id=account_id or None,
                phone_number=phone_number,
                contact_name=contact_name,
                duration=duration,
                status=status,
                notes=notes,
                called_by_user_id=user_id,
                twilio_call_sid=twilio_call_sid,
                created_time=now,
                updated_time=now,
                is_active=True,
            )
            session.add(log)
            session.flush()
            session.refresh(log)
            call_id = log.id

    # Log activity for timeline + save notes — only on the FINAL save (not the early "in-progress" creation)
    if status != "in-progress":
        dur_min = duration // 60
        dur_sec = duration % 60
        dur_label = f"{dur_min}:{dur_sec:02d}" if dur_min > 0 else f"{dur_sec}s"

        # Build activity description — always include the dialed number
        # (it's editable before placing the call, so the timeline must
        # reflect what was actually dialed, not just the contact name).
        who = (
            f"{contact_name} ({phone_number})"
            if contact_name and phone_number
            else (contact_name or phone_number or "—")
        )
        desc = f"Call to {who} ({dur_label}) — {status}"
        if notes:
            desc += f"\n\nNotes: {notes}"

        with get_session() as session:
            session.add(CXActivity(
                potential_id=potential_id,
                contact_id=contact_id,
                account_id=account_id or None,
                activity_type="call_logged",
                description=desc,
                performed_by_user_id=user_id,
                created_time=now,
                updated_time=now,
                is_active=True,
            ))
            session.flush()

        # Also create a CXNote so call notes appear in the Notes tab
        if notes:
            from core.models import CXNote
            with get_session() as session:
                session.add(CXNote(
                    potential_id=potential_id,
                    content=f"📞 Call with {who} ({dur_label})\n\n{notes}",
                    created_by_user_id=user_id,
                    created_time=now,
                    updated_time=now,
                    is_active=True,
                ))
                session.flush()

        logger.info("Call logged: potential=%s contact=%s duration=%s sid=%s", potential_id, contact_name, dur_label, twilio_call_sid)

    return CallLogItem(
        id=call_id,
        potential_id=potential_id,
        contact_id=contact_id,
        phone_number=phone_number,
        contact_name=contact_name,
        duration=duration,
        status=status,
        notes=notes,
        twilio_call_sid=twilio_call_sid,
        created_time=now,
    )


# ── Post-call recording retrieval ────────────────────────────────────────────

def process_recording(
    call_sid: str,
    recording_sid: str,
    recording_url: str,
    parent_call_sid: str | None = None,
) -> None:
    """Download a recording from Twilio and attach it to the call log as a file.

    Called by the recording-status webhook when the recording is ready.

    For `<Dial record="record-from-answer-dual">` the recording webhook can report
    either the parent (browser client) call SID or the child (PSTN) call SID in
    `CallSid`, depending on which leg Twilio attributes the recording to. The
    CXCallLog row is always created with the parent SID (from the browser SDK),
    so we try both SIDs when looking it up.
    """
    logger.info(
        "Processing recording: call_sid=%s parent_call_sid=%s recording_sid=%s",
        call_sid, parent_call_sid, recording_sid,
    )

    candidate_sids = [s for s in (call_sid, parent_call_sid) if s]

    # Find the call log row by Twilio SID — try both call_sid and parent_call_sid
    with get_session() as session:
        log = session.execute(
            select(CXCallLog).where(
                CXCallLog.twilio_call_sid.in_(candidate_sids),
                CXCallLog.is_active == True,
            )
        ).scalar_one_or_none()
        if not log:
            logger.warning(
                "No call log found for call_sid=%s parent_call_sid=%s — skipping recording",
                call_sid, parent_call_sid,
            )
            return
        potential_id = log.potential_id
        log_id = log.id

    # Download the recording from Twilio (MP3 format)
    media_url = f"{recording_url}.mp3"
    try:
        resp = httpx.get(
            media_url,
            auth=(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN),
            follow_redirects=True,
            timeout=60,
        )
        resp.raise_for_status()
        audio_bytes = resp.content
        content_type = resp.headers.get("content-type", "audio/mpeg")
    except Exception as e:
        logger.error("Failed to download recording %s: %s", media_url, e)
        return

    # CXCallLog.potential_id holds the UUID; CX_Files.PotentialId keys on
    # potential_number (7-digit). Resolve at the boundary.
    from api.services.file_service import _resolve_potential_number
    pn = _resolve_potential_number(potential_id)

    # Save to GCS via the existing file service pattern
    now = datetime.now(timezone.utc)
    file_name = f"call_recording_{call_sid}.mp3"

    try:
        from google.cloud import storage as gcs_storage
        client = gcs_storage.Client()
        bucket = client.bucket(config.GCS_BUCKET_NAME)
        gcs_path = f"{config.GCS_ENV}/potentials/{pn}/files/{file_name}"
        blob = bucket.blob(gcs_path)
        blob.upload_from_string(audio_bytes, content_type=content_type)
        logger.info("Uploaded recording to GCS: %s", gcs_path)
    except Exception as e:
        logger.error("Failed to upload recording to GCS: %s", e)
        gcs_path = ""

    # Create CXFile row
    with get_session() as session:
        file_row = CXFile(
            potential_id=pn,
            file_name=file_name,
            mime_type=content_type,
            file_size=len(audio_bytes),
            storage_path=gcs_path,
            created_by_user_id=None,  # system upload (call recording)
            created_time=now,
            updated_time=now,
            is_active=True,
        )
        session.add(file_row)
        session.flush()
        session.refresh(file_row)
        file_id = file_row.id

    # Update the call log with recording info
    with get_session() as session:
        log = session.get(CXCallLog, log_id)
        if log:
            log.recording_url = gcs_path
            log.recording_file_id = file_id
            log.updated_time = now
            session.add(log)

    logger.info("Recording processed: call_sid=%s file_id=%d", call_sid, file_id)


def update_call_status(call_sid: str, status: str, duration: int | None = None) -> None:
    """Update a call log's status and duration from Twilio's status callback."""
    now = datetime.now(timezone.utc)
    with get_session() as session:
        log = session.execute(
            select(CXCallLog).where(
                CXCallLog.twilio_call_sid == call_sid,
                CXCallLog.is_active == True,
            )
        ).scalar_one_or_none()
        if not log:
            logger.warning("No call log found for status update: call_sid=%s", call_sid)
            return
        log.status = status
        if duration is not None:
            log.duration = duration
        log.updated_time = now
        session.add(log)
