"""Meeting Briefs endpoints — list + dismiss."""

from fastapi import APIRouter, Body, Depends, Query
from pydantic import BaseModel

from core.auth import get_current_active_user, is_impersonating
from core.exceptions import BotApiException
from core.models import User
from core.schemas import ResponseModel
from api.services.meeting_brief_service import get_upcoming_briefs, resolve_meeting_brief

router = APIRouter(prefix="/meetings/briefs", tags=["meeting-briefs"])


class ResolveBriefRequest(BaseModel):
    action: str  # 'done' | 'skipped'


@router.get("/upcoming")
async def upcoming_briefs(
    hours_ahead: int = Query(default=24, ge=1, le=72),
    user: User = Depends(get_current_active_user),
) -> ResponseModel[list[dict]]:
    """Return [{ skeleton, brief }] for qualifying client meetings in the next N hours.

    Idempotent: cache hits are instant; only triggers the agent for missing or
    stale briefs. Designed to be called on dashboard mount and on tab focus.
    """
    # Impersonated user may not have connected MS — swallow the 424 and return
    # empty so the superadmin doesn't get pushed into a reconnect flow.
    try:
        items = await get_upcoming_briefs(user.user_id, hours_ahead=hours_ahead)
    except BotApiException as e:
        if e.code == 424 and is_impersonating(user):
            return ResponseModel(data=[])
        raise
    return ResponseModel(data=items)


@router.post("/{ms_event_id}/resolve")
def resolve_brief(
    ms_event_id: str,
    data: ResolveBriefRequest = Body(),
    user: User = Depends(get_current_active_user),
) -> ResponseModel[dict]:
    """Mark a meeting brief as done or skipped for the current user.
    Removes it from the upcoming briefs list permanently."""
    # Map UI 'skip' → DB 'skipped'
    status = "skipped" if data.action == "skip" else data.action
    if status not in ("done", "skipped"):
        raise BotApiException(400, "ERR_VALIDATION", "action must be 'done' or 'skip'")
    ok = resolve_meeting_brief(user.user_id, ms_event_id, status)
    if not ok:
        raise BotApiException(400, "ERR_VALIDATION", f"Invalid status '{status}'")
    return ResponseModel(data={"ms_event_id": ms_event_id, "status": status})
