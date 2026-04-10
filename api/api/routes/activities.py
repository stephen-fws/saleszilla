"""Activity timeline endpoints."""

from fastapi import APIRouter, Depends, Query

from core.auth import get_current_active_user
from core.models import User
from core.schemas import ActivityItem, ResponseModel
from api.services.access_control import require_potential_owner
from api.services.activity_service import list_activities

router = APIRouter(prefix="/potentials/{potential_id}/activities", tags=["activities"])


@router.get("")
def get_activities(
    potential_id: str,
    limit: int = Query(default=50, ge=1, le=200),
    user: User = Depends(get_current_active_user),
) -> ResponseModel[list[ActivityItem]]:
    require_potential_owner(user.user_id, potential_id)
    return ResponseModel(data=list_activities(potential_id, limit=limit))
