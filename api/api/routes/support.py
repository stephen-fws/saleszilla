"""Support email route."""

from fastapi import APIRouter, Body, Depends
from pydantic import BaseModel

from core.auth import get_current_active_user
from core.exceptions import BotApiException
from core.models import User
from core.schemas import ResponseModel
from api.services.access_control import require_potential_owner
from api.services.support_service import SUPPORT_CATEGORIES, send_support_email

router = APIRouter(tags=["support"])


class SupportEmailRequest(BaseModel):
    potential_id: str
    category: str
    message: str | None = None


@router.get("/support/categories")
def get_support_categories() -> ResponseModel[dict]:
    return ResponseModel(data=SUPPORT_CATEGORIES)


@router.post("/support/email")
async def post_support_email(
    data: SupportEmailRequest = Body(),
    user: User = Depends(get_current_active_user),
) -> ResponseModel[dict]:
    require_potential_owner(user.user_id, data.potential_id)
    if data.category not in SUPPORT_CATEGORIES:
        raise BotApiException(400, "ERR_INVALID_CATEGORY", "Unknown support category.")
    ok = await send_support_email(
        potential_id=data.potential_id,
        category=data.category,
        user_message=(data.message or "").strip(),
        reporter=user,
    )
    if not ok:
        raise BotApiException(500, "ERR_SUPPORT_EMAIL_FAILED", "Failed to send support email.")
    return ResponseModel(message_code="MSG_SUPPORT_EMAIL_SENT", data={"ok": True})
