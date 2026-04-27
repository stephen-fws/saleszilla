"""AI chat endpoints — per-potential conversation with Claude streaming."""

from fastapi import APIRouter, Body, Depends
from fastapi.responses import StreamingResponse

from core.auth import get_current_active_user
from core.models import User
from core.schemas import ChatMessageItem, ResponseModel, SendChatRequest
from api.services.access_control import require_potential_owner
from api.services.chat_service import clear_history, generate_suggestions, list_messages, save_message, stream_chat

router = APIRouter(tags=["chat"])


@router.get("/potentials/{potential_id}/chat/history")
def get_chat_history(
    potential_id: str,
    user: User = Depends(get_current_active_user),
) -> ResponseModel[list[ChatMessageItem]]:
    require_potential_owner(user.user_id, potential_id)
    return ResponseModel(data=list_messages(user.user_id, potential_id))


@router.post("/potentials/{potential_id}/chat")
def post_chat(
    potential_id: str,
    data: SendChatRequest = Body(),
    user: User = Depends(get_current_active_user),
):
    """Stream Claude response as SSE. Saves both user + assistant messages."""
    require_potential_owner(user.user_id, potential_id)
    history = list_messages(user.user_id, potential_id)

    return StreamingResponse(
        stream_chat(user.user_id, potential_id, data.message, history),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.get("/potentials/{potential_id}/chat/suggestions")
def get_chat_suggestions(
    potential_id: str,
    user: User = Depends(get_current_active_user),
) -> ResponseModel[list[str]]:
    """Return 5 AI-generated suggested questions based on current deal state."""
    require_potential_owner(user.user_id, potential_id)
    return ResponseModel(data=generate_suggestions(potential_id, user.user_id))


@router.delete("/potentials/{potential_id}/chat/history")
def delete_chat_history(
    potential_id: str,
    user: User = Depends(get_current_active_user),
) -> ResponseModel[dict]:
    require_potential_owner(user.user_id, potential_id)
    count = clear_history(user.user_id, potential_id)
    return ResponseModel(data={"deleted": count})
