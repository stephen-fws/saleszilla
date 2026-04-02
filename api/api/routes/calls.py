"""Call log endpoints."""

from fastapi import APIRouter, Body, Depends

from core.auth import get_current_active_user
from core.models import User
from core.schemas import CallLogItem, CreateCallLogRequest, ResponseModel
from api.services.call_service import create_call, list_calls

router = APIRouter(prefix="/potentials/{potential_id}/calls", tags=["calls"])


@router.get("")
def get_calls(potential_id: str, user: User = Depends(get_current_active_user)) -> ResponseModel[list[CallLogItem]]:
    return ResponseModel(data=list_calls(potential_id))


@router.post("")
def post_call(
    potential_id: str,
    data: CreateCallLogRequest = Body(),
    user: User = Depends(get_current_active_user),
) -> ResponseModel[CallLogItem]:
    result = create_call(
        potential_id=potential_id,
        phone_number=data.phone_number,
        contact_name=data.contact_name,
        duration=data.duration,
        status=data.status,
        notes=data.notes,
        contact_id=data.contact_id,
        account_id=data.account_id,
        user_id=user.user_id,
    )
    return ResponseModel(data=result)
