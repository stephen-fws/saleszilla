"""Calendar events endpoints — MS Graph backed."""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query

from core.auth import get_current_active_user
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
        )
        for a in raw_attendees
        if a.get("emailAddress", {}).get("address")
    ]
    return CalendarEventResponse(
        id=e.get("id", ""),
        subject=e.get("subject", ""),
        body_preview=e.get("bodyPreview"),
        start=start.get("dateTime"),
        end=end.get("dateTime"),
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
    ms_token = await get_valid_ms_token(user.user_id)

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
