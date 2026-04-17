"""Per-user preferences stored on CX_UserTokens (email signature, working hours, timezone)."""

import re
from datetime import datetime, timezone as tz

from sqlalchemy import select

from core.database import get_session
from core.models import CXUserToken
from core.schemas import UserSettingsResponse, UserSettingsUpdateRequest


# Sensible defaults applied when a user hasn't configured these yet
DEFAULT_WORKING_HOURS_START = "09:00"
DEFAULT_WORKING_HOURS_END = "18:00"
DEFAULT_TIMEZONE = "Asia/Kolkata"

_TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def _validate_time(value: str | None, field: str) -> None:
    if value is None:
        return
    if not _TIME_RE.match(value):
        raise ValueError(f"{field} must be HH:MM in 24-hour format (got '{value}')")


def _get_active_token_row(session, user_id: str) -> CXUserToken | None:
    return session.execute(
        select(CXUserToken).where(
            CXUserToken.user_id == user_id,
            CXUserToken.is_active == True,
        ).limit(1)
    ).scalar_one_or_none()


def get_settings(user_id: str) -> UserSettingsResponse:
    """Return current settings, falling back to defaults for unset fields."""
    with get_session() as session:
        row = _get_active_token_row(session, user_id)
        if not row:
            return UserSettingsResponse(
                email_signature=None,
                working_hours_start=DEFAULT_WORKING_HOURS_START,
                working_hours_end=DEFAULT_WORKING_HOURS_END,
                timezone=DEFAULT_TIMEZONE,
            )
        return UserSettingsResponse(
            email_signature=row.email_signature,
            working_hours_start=row.working_hours_start or DEFAULT_WORKING_HOURS_START,
            working_hours_end=row.working_hours_end or DEFAULT_WORKING_HOURS_END,
            timezone=row.timezone or DEFAULT_TIMEZONE,
        )


def update_settings(user_id: str, data: UserSettingsUpdateRequest) -> UserSettingsResponse:
    """Patch-style update — only the fields the caller provides are changed."""
    _validate_time(data.working_hours_start, "working_hours_start")
    _validate_time(data.working_hours_end, "working_hours_end")

    now = datetime.now(tz.utc)
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
        row.updated_time = now
        session.add(row)
        session.flush()
        session.refresh(row)

        return UserSettingsResponse(
            email_signature=row.email_signature,
            working_hours_start=row.working_hours_start or DEFAULT_WORKING_HOURS_START,
            working_hours_end=row.working_hours_end or DEFAULT_WORKING_HOURS_END,
            timezone=row.timezone or DEFAULT_TIMEZONE,
        )
