"""Queue and folder endpoints."""

from fastapi import APIRouter, Depends

from core.auth import get_current_active_user
from core.exceptions import BotApiException
from core.models import User
from core.schemas import FolderItem, QueueItemResponse, ResponseModel
from api.services.queue_service import complete_queue_item, list_folders, list_queue_items, resolve_queue_item

router = APIRouter(tags=["queue"])


@router.get("/folders")
def get_folders(
    user: User = Depends(get_current_active_user),
) -> ResponseModel[list[FolderItem]]:
    folders = list_folders(user_id=user.user_id)
    return ResponseModel(data=folders)


@router.get("/queue/{folder_type}")
def get_queue(
    folder_type: str,
    user: User = Depends(get_current_active_user),
) -> ResponseModel[list[QueueItemResponse]]:
    items = list_queue_items(folder_type=folder_type, user_id=user.user_id)
    return ResponseModel(data=items)


@router.post("/queue-items/{item_id}/complete")
def post_complete_queue_item(
    item_id: int,
    user: User = Depends(get_current_active_user),
) -> ResponseModel[dict]:
    success = complete_queue_item(item_id)
    if not success:
        raise BotApiException(404, "ERR_NOT_FOUND", "Queue item not found.")
    return ResponseModel(message_code="MSG_COMPLETED", data={"id": item_id, "status": "completed"})


@router.post("/queue-items/{item_id}/skip")
def post_skip_queue_item(
    item_id: int,
    user: User = Depends(get_current_active_user),
) -> ResponseModel[dict]:
    """Mark an AI-suggested queue item as skipped — user doesn't need it."""
    success = resolve_queue_item(item_id, "skipped")
    if not success:
        raise BotApiException(404, "ERR_NOT_FOUND", "Queue item not found.")
    return ResponseModel(message_code="MSG_SKIPPED", data={"id": item_id, "status": "skipped"})
