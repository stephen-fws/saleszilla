"""Global cross-entity AI chat endpoints — multi-conversation."""

from fastapi import APIRouter, Body, Depends, File, Form, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from core.auth import get_current_active_user
from core.exceptions import BotApiException
from core.models import User
from core.schemas import ChatMessageItem, ResponseModel, SendChatRequest
from api.services.global_chat_service import (
    create_conversation,
    delete_conversation,
    list_conversation_messages,
    list_conversations,
    rename_conversation,
    stream_global_chat,
)
from api.services.chat_attachments import enrich_message_with_attachments

router = APIRouter(prefix="/chat/global", tags=["global-chat"])


class RenameRequest(BaseModel):
    title: str


# ── Conversations CRUD ───────────────────────────────────────────────────────

@router.get("/conversations")
def get_conversations(
    user: User = Depends(get_current_active_user),
) -> ResponseModel[list[dict]]:
    return ResponseModel(data=list_conversations(user.user_id))


@router.post("/conversations")
def post_conversation(
    user: User = Depends(get_current_active_user),
) -> ResponseModel[dict]:
    return ResponseModel(data=create_conversation(user.user_id))


@router.delete("/conversations/{conversation_id}")
def remove_conversation(
    conversation_id: int,
    user: User = Depends(get_current_active_user),
) -> ResponseModel[dict]:
    ok = delete_conversation(user.user_id, conversation_id)
    if not ok:
        raise BotApiException(404, "ERR_NOT_FOUND", "Conversation not found.")
    return ResponseModel(data={"ok": True})


@router.patch("/conversations/{conversation_id}")
def patch_conversation(
    conversation_id: int,
    data: RenameRequest = Body(),
    user: User = Depends(get_current_active_user),
) -> ResponseModel[dict]:
    ok = rename_conversation(user.user_id, conversation_id, data.title)
    if not ok:
        raise BotApiException(404, "ERR_NOT_FOUND", "Conversation not found.")
    return ResponseModel(data={"ok": True})


# ── Messages ─────────────────────────────────────────────────────────────────

@router.get("/conversations/{conversation_id}/messages")
def get_messages(
    conversation_id: int,
    user: User = Depends(get_current_active_user),
) -> ResponseModel[list[ChatMessageItem]]:
    return ResponseModel(data=list_conversation_messages(user.user_id, conversation_id))


@router.post("/conversations/{conversation_id}")
def post_message(
    conversation_id: int,
    data: SendChatRequest = Body(),
    user: User = Depends(get_current_active_user),
):
    """Stream Claude response with multi-turn tool use as SSE (JSON body, no attachments)."""
    history = list_conversation_messages(user.user_id, conversation_id)
    return StreamingResponse(
        stream_global_chat(user, conversation_id, data.message, history),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.post("/conversations/{conversation_id}/upload")
async def post_message_with_files(
    conversation_id: int,
    message: str = Form(...),
    files: list[UploadFile] = File(default=[]),
    user: User = Depends(get_current_active_user),
):
    """Stream Claude response with optional file attachments (multipart upload)."""
    # Read all uploaded files into memory and extract text
    file_tuples: list[tuple[str, bytes]] = []
    for f in files:
        content = await f.read()
        file_tuples.append((f.filename or "unnamed", content))

    enriched_message, _summaries = enrich_message_with_attachments(message, file_tuples)

    history = list_conversation_messages(user.user_id, conversation_id)
    return StreamingResponse(
        stream_global_chat(user, conversation_id, enriched_message, history),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
