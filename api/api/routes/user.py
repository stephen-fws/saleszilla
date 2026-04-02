"""User profile routes."""

from fastapi import APIRouter, Depends

from core.auth import get_current_active_user
from core.models import User
from core.schemas import ResponseModel, UserInfo
from api.services.user_service import get_user_info
from core.exceptions import BotApiException

router = APIRouter(tags=["user"])


@router.get("/me")
async def get_me(
    user: User = Depends(get_current_active_user),
) -> ResponseModel[UserInfo]:
    """Return authenticated user info including MS connection status."""
    user_info = get_user_info(user.user_id)
    if not user_info:
        raise BotApiException(404, "ERR_USER_NOT_FOUND", "User not found.")
    return ResponseModel(data=user_info)
