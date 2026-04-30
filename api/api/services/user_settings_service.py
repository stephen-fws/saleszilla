"""Per-user preferences stored on CX_UserTokens (email signature, working hours, timezone)."""

import logging
import re
from datetime import datetime, timezone as tz

from sqlalchemy import select

import core.config as config
from core.database import get_session
from core.models import CXUserToken
from core.schemas import UserSettingsResponse, UserSettingsUpdateRequest


# Sensible defaults applied when a user hasn't configured these yet
DEFAULT_WORKING_HOURS_START = "09:00"
DEFAULT_WORKING_HOURS_END = "18:00"
DEFAULT_TIMEZONE = "Asia/Kolkata"

_TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
# E.164: leading "+", then 1-15 digits.
_E164_RE = re.compile(r"^\+[1-9]\d{1,14}$")

logger = logging.getLogger(__name__)


def _validate_time(value: str | None, field: str) -> None:
    if value is None:
        return
    if not _TIME_RE.match(value):
        raise ValueError(f"{field} must be HH:MM in 24-hour format (got '{value}')")


def _validate_twilio_number(value: str | None) -> None:
    """Ensure the number is E.164 AND attached to the org's Twilio account.
    Empty string is treated as "clear the field" — allowed without API call.
    """
    if value is None or value == "":
        return
    if not _E164_RE.match(value):
        raise ValueError(f"twilio_number must be in E.164 format (e.g. '+14155551234'), got '{value}'")
    # Verify the number is owned by the configured Twilio account. Skip when
    # Twilio creds aren't set (local dev) — the user just won't be able to
    # call until prod creds are wired.
    if not config.TWILIO_ACCOUNT_SID or not config.TWILIO_AUTH_TOKEN:
        logger.warning("twilio_number validation: Twilio creds not configured — skipping ownership check")
        return
    try:
        from twilio.rest import Client as TwilioClient
        client = TwilioClient(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN)
        rows = client.incoming_phone_numbers.list(phone_number=value, limit=1)
        if not rows:
            raise ValueError(f"'{value}' is not provisioned on the org's Twilio account.")
    except ValueError:
        raise
    except Exception as exc:
        logger.exception("twilio_number ownership check failed: %s", exc)
        raise ValueError("Could not verify the number with Twilio. Try again in a moment.")


def _get_active_token_row(session, user_id: str) -> CXUserToken | None:
    return session.execute(
        select(CXUserToken).where(
            CXUserToken.user_id == user_id,
            CXUserToken.is_active == True,
        ).limit(1)
    ).scalar_one_or_none()


def get_settings(user_id: str) -> UserSettingsResponse:
    """Return current settings, falling back to defaults for unset fields."""
    org_default_number = config.TWILIO_CALLING_NUMBER or None
    with get_session() as session:
        row = _get_active_token_row(session, user_id)
        if not row:
            return UserSettingsResponse(
                email_signature=None,
                working_hours_start=DEFAULT_WORKING_HOURS_START,
                working_hours_end=DEFAULT_WORKING_HOURS_END,
                timezone=DEFAULT_TIMEZONE,
                twilio_number=None,
                twilio_default_number=org_default_number,
            )
        return UserSettingsResponse(
            email_signature=row.email_signature,
            working_hours_start=row.working_hours_start or DEFAULT_WORKING_HOURS_START,
            working_hours_end=row.working_hours_end or DEFAULT_WORKING_HOURS_END,
            timezone=row.timezone or DEFAULT_TIMEZONE,
            twilio_number=row.twilio_number,
            twilio_default_number=org_default_number,
        )


def update_settings(user_id: str, data: UserSettingsUpdateRequest) -> UserSettingsResponse:
    """Patch-style update — only the fields the caller provides are changed."""
    _validate_time(data.working_hours_start, "working_hours_start")
    _validate_time(data.working_hours_end, "working_hours_end")
    _validate_twilio_number(data.twilio_number)

    now = datetime.now(tz.utc)
    org_default_number = config.TWILIO_CALLING_NUMBER or None
    with get_session() as session:
        row = _get_active_token_row(session, user_id)
        if not row:
            # No token row exists yet — create a minimal one so preferences can persist
            row = CXUserToken(
                user_id=user_id,
                provider="microsoft",
                created_time=now,
                updated_time=now,
                is_active=True,
            )
            session.add(row)
            session.flush()

        if data.email_signature is not None:
            row.email_signature = data.email_signature
        if data.working_hours_start is not None:
            row.working_hours_start = data.working_hours_start
        if data.working_hours_end is not None:
            row.working_hours_end = data.working_hours_end
        if data.timezone is not None:
            row.timezone = data.timezone
        if data.twilio_number is not None:
            # Empty string clears the field (revert to org default).
            row.twilio_number = data.twilio_number or None
        row.updated_time = now
        session.add(row)
        session.flush()
        session.refresh(row)

        return UserSettingsResponse(
            email_signature=row.email_signature,
            working_hours_start=row.working_hours_start or DEFAULT_WORKING_HOURS_START,
            working_hours_end=row.working_hours_end or DEFAULT_WORKING_HOURS_END,
            timezone=row.timezone or DEFAULT_TIMEZONE,
            twilio_number=row.twilio_number,
            twilio_default_number=org_default_number,
        )
