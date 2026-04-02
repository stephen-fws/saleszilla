"""AI chat endpoints."""

from fastapi import APIRouter, Body, Depends

from core.auth import get_current_active_user
from core.models import User
from core.schemas import ChatMessageItem, ResponseModel, SendChatRequest
from api.services.chat_service import clear_history, list_messages, save_message

router = APIRouter(prefix="/chat", tags=["chat"])


@router.get("/history")
def get_history(
    user: User = Depends(get_current_active_user),
) -> ResponseModel[list[ChatMessageItem]]:
    return ResponseModel(data=list_messages(user.user_id))


@router.post("")
def post_chat(
    data: SendChatRequest = Body(),
    user: User = Depends(get_current_active_user),
) -> ResponseModel[ChatMessageItem]:
    """
    Save user message and return it.

    Note: AI response generation will be handled separately
    (either via the external agent system or a dedicated AI endpoint).
    For now, this just persists the user's message.
    """
    msg = save_message(user.user_id, "user", data.message)
    return ResponseModel(data=msg)


@router.delete("/history")
def delete_history(
    user: User = Depends(get_current_active_user),
) -> ResponseModel[dict]:
    count = clear_history(user.user_id)
    return ResponseModel(data={"deleted": count})
