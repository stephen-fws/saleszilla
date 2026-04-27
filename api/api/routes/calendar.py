"""Calendar events endpoints — MS Graph backed."""

import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query

# Optional zoneinfo support — Windows needs the `tzdata` pip package for the
# IANA database. We try the import but tolerate failure and fall back to a
# manual fixed-offset table below for the timezones we actually see in practice.
try:
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError  # type: ignore
    _HAS_ZONEINFO = True
except Exception:  # pragma: no cover
    ZoneInfo = None  # type: ignore
    ZoneInfoNotFoundError = Exception  # type: ignore
    _HAS_ZONEINFO = False

logger = logging.getLogger(__name__)

# Manual UTC-offset fallback (in hours) for the most common timezones MS Graph
# returns. Used when zoneinfo isn't available (Windows w/o tzdata) or when the
# label can't be resolved. NOTE: this does NOT handle DST transitions — for
# DST-aware behaviour install the `tzdata` package which lights up zoneinfo.
WINDOWS_TZ_OFFSETS_HOURS = {
    "UTC": 0,
    "Coordinated Universal Time": 0,
    "India Standard Time": 5.5,
    "Asia/Kolkata": 5.5,
    "Asia/Calcutta": 5.5,
    "Pacific Standard Time": -8,
    "Eastern Standard Time": -5,
    "Central Standard Time": -6,
    "Mountain Standard Time": -7,
    "GMT Standard Time": 0,
    "Romance Standard Time": 1,
    "W. Europe Standard Time": 1,
    "Central European Standard Time": 1,
    "Singapore Standard Time": 8,
    "Tokyo Standard Time": 9,
    "AUS Eastern Standard Time": 10,
    "China Standard Time": 8,
    "Arabian Standard Time": 4,
}

# Map Windows tz names to IANA names for the zoneinfo path (when tzdata is available)
WINDOWS_TZ_TO_IANA = {
    "UTC": "UTC",
    "Coordinated Universal Time": "UTC",
    "India Standard Time": "Asia/Kolkata",
    "Pacific Standard Time": "America/Los_Angeles",
    "Eastern Standard Time": "America/New_York",
    "Central Standard Time": "America/Chicago",
    "Mountain Standard Time": "America/Denver",
    "GMT Standard Time": "Europe/London",
    "Romance Standard Time": "Europe/Paris",
    "W. Europe Standard Time": "Europe/Berlin",
    "Central European Standard Time": "Europe/Warsaw",
    "Singapore Standard Time": "Asia/Singapore",
    "Tokyo Standard Time": "Asia/Tokyo",
    "AUS Eastern Standard Time": "Australia/Sydney",
    "China Standard Time": "Asia/Shanghai",
    "Arabian Standard Time": "Asia/Dubai",
}


def _resolve_tz(tz_label: str):
    """Resolve a Graph timezone label to a tzinfo. Prefers zoneinfo if available,
    otherwise falls back to a fixed UTC-offset constructed from WINDOWS_TZ_OFFSETS_HOURS.
    """
    if _HAS_ZONEINFO:
        # Try IANA first
        try:
            return ZoneInfo(tz_label)
        except Exception:
            pass
        # Try Windows → IANA mapping
        iana = WINDOWS_TZ_TO_IANA.get(tz_label)
        if iana:
            try:
                return ZoneInfo(iana)
            except Exception:
                pass

    # Fallback to fixed offset
    offset_hours = WINDOWS_TZ_OFFSETS_HOURS.get(tz_label)
    if offset_hours is None:
        logger.warning("Unknown timezone '%s' from MS Graph, defaulting to UTC", tz_label)
        return timezone.utc
    return timezone(timedelta(hours=offset_hours))


def _graph_dt_to_utc_iso(field: dict) -> str | None:
    """Convert MS Graph's `{dateTime, timeZone}` block to a UTC ISO string with 'Z'.

    Graph may return timeZone as either an IANA name (when Prefer outlook.timezone
    is set) OR as a Windows-style name (default for create/update responses).
    Either way we parse + convert to UTC explicitly so the frontend can rely
    on the +Z parse.
    """
    if not field:
        return None
    raw_dt = field.get("dateTime")
    if not raw_dt:
        return None
    tz_label = field.get("timeZone") or "UTC"

    tz = _resolve_tz(tz_label)

    # Parse the naive dateTime and attach the tz
    try:
        # Graph sends fractional seconds like "2026-04-08T17:45:00.0000000"
        # which Python's fromisoformat can't always parse — trim to 6 digits.
        cleaned = raw_dt
        if "." in cleaned:
            head, frac = cleaned.split(".", 1)
            cleaned = f"{head}.{frac[:6]}"
        naive = datetime.fromisoformat(cleaned)
    except ValueError as e:
        logger.error("Failed to parse Graph dateTime '%s': %s", raw_dt, e)
        return raw_dt  # last-resort fallback
    aware = naive.replace(tzinfo=tz)
    utc = aware.astimezone(timezone.utc)
    return utc.strftime("%Y-%m-%dT%H:%M:%SZ")

from core.auth import get_current_active_user, is_impersonating
from core.exceptions import BotApiException
from core.models import User
from core.ms_graph import (
    create_calendar_event,
    delete_calendar_event,
    fetch_calendar_events,
    get_valid_ms_token,
    search_people,
    update_calendar_event,
)
from core.schemas import (
    CalendarAttendeeResponse,
    CalendarEventResponse,
    CreateCalendarEventRequest,
    PersonResult,
    ResponseModel,
    UpdateCalendarEventRequest,
)

router = APIRouter(prefix="/calendar", tags=["calendar"])

GRAPH_EVENT_SELECT = (
    "id,subject,bodyPreview,start,end,isAllDay,isCancelled,"
    "showAs,responseStatus,organizer,attendees,location,"
    "isOnlineMeeting,onlineMeeting,recurrence,categories"
)


def _map_event(e: dict) -> CalendarEventResponse:
    start = e.get("start", {})
    end = e.get("end", {})
    organizer = e.get("organizer", {}).get("emailAddress", {})
    location = e.get("location", {})
    online = e.get("onlineMeeting") or {}
    raw_attendees = e.get("attendees") or []
    attendees = [
        CalendarAttendeeResponse(
            email=a.get("emailAddress", {}).get("address", ""),
            name=a.get("emailAddress", {}).get("name") or None,
            type=a.get("type", "required"),
            response=(a.get("status") or {}).get("response", "none"),
        )
        for a in raw_attendees
        if a.get("emailAddress", {}).get("address")
    ]
    return CalendarEventResponse(
        id=e.get("id", ""),
        subject=e.get("subject", ""),
        body_preview=e.get("bodyPreview"),
        start=_graph_dt_to_utc_iso(start),
        end=_graph_dt_to_utc_iso(end),
        is_all_day=e.get("isAllDay", False),
        is_cancelled=e.get("isCancelled", False),
        show_as=e.get("showAs", "busy"),
        organizer_email=organizer.get("address"),
        organizer_name=organizer.get("name"),
        location=location.get("displayName"),
        is_online_meeting=e.get("isOnlineMeeting", False),
        online_meeting_url=online.get("joinUrl"),
        is_recurring=e.get("recurrence") is not None,
        attendees=attendees,
    )


@router.get("/events")
async def get_calendar_events(
    user: User = Depends(get_current_active_user),
    weeks: int = Query(default=4, ge=1, le=52),
) -> ResponseModel[list[CalendarEventResponse]]:
    # If a superadmin is viewing as a user who hasn't connected MS, return
    # empty rather than a 424 reconnect prompt — the prompt would target the
    # admin, not the impersonated user.
    try:
        ms_token = await get_valid_ms_token(user.user_id)
    except BotApiException as e:
        if e.code == 424 and is_impersonating(user):
            return ResponseModel(data=[])
        raise

    now = datetime.now(timezone.utc)
    start_dt = now - timedelta(days=now.weekday())
    start_dt = start_dt.replace(hour=0, minute=0, second=0, microsecond=0)
    end_dt = start_dt + timedelta(weeks=weeks)

    raw_events = await fetch_calendar_events(ms_token, start_dt, end_dt)
    events = [_map_event(e) for e in raw_events if not e.get("isCancelled")]
    return ResponseModel(data=events)


@router.post("/events")
async def create_event(
    data: CreateCalendarEventRequest,
    user: User = Depends(get_current_active_user),
) -> ResponseModel[CalendarEventResponse]:
    ms_token = await get_valid_ms_token(user.user_id)
    raw = await create_calendar_event(
        access_token=ms_token,
        subject=data.subject,
        start_dt=data.start,
        end_dt=data.end,
        timezone_str=data.timezone,
        location=data.location,
        body=data.body,
        is_online_meeting=data.is_online_meeting,
        required_attendees=data.required_attendees,
        optional_attendees=data.optional_attendees,
    )
    return ResponseModel(data=_map_event(raw))


@router.patch("/events/{event_id}")
async def update_event(
    event_id: str,
    data: UpdateCalendarEventRequest,
    user: User = Depends(get_current_active_user),
) -> ResponseModel[CalendarEventResponse]:
    ms_token = await get_valid_ms_token(user.user_id)
    raw = await update_calendar_event(
        access_token=ms_token,
        event_id=event_id,
        subject=data.subject,
        start_dt=data.start,
        end_dt=data.end,
        timezone_str=data.timezone,
        location=data.location,
        body=data.body,
        is_online_meeting=data.is_online_meeting,
        required_attendees=data.required_attendees,
        optional_attendees=data.optional_attendees,
    )
    return ResponseModel(data=_map_event(raw))


@router.delete("/events/{event_id}")
async def remove_event(
    event_id: str,
    user: User = Depends(get_current_active_user),
) -> ResponseModel[dict]:
    ms_token = await get_valid_ms_token(user.user_id)
    try:
        await delete_calendar_event(ms_token, event_id)
    except Exception:
        raise BotApiException(404, "ERR_NOT_FOUND", "Event not found or already deleted.")
    return ResponseModel(data={"ok": True})


@router.get("/people")
async def people_search(
    q: str = Query(min_length=1),
    user: User = Depends(get_current_active_user),
) -> ResponseModel[list[PersonResult]]:
    ms_token = await get_valid_ms_token(user.user_id)
    raw = await search_people(ms_token, q)
    results = [PersonResult(name=p["name"], email=p["email"], job_title=p.get("jobTitle")) for p in raw]
    return ResponseModel(data=results)
