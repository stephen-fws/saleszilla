"""Todos CRUD endpoints."""

from fastapi import APIRouter, Body, Depends

from core.auth import get_current_active_user
from core.exceptions import BotApiException
from core.models import User
from core.schemas import CreateTodoRequest, ResponseModel, TodoItem, TODO_STATUSES, UpdateTodoRequest
from api.services.todo_service import create_todo, delete_todo, list_todos, update_todo
from api.services.activity_service import log_activity

router = APIRouter(prefix="/potentials/{potential_id}/todos", tags=["todos"])

_STATUS_LABELS = {
    "pending": "Pending",
    "in_progress": "In Progress",
    "on_hold": "On Hold",
    "done": "Done",
}


@router.get("")
def get_todos(potential_id: str, user: User = Depends(get_current_active_user)) -> ResponseModel[list[TodoItem]]:
    return ResponseModel(data=list_todos(potential_id))


@router.post("")
def post_todo(
    potential_id: str,
    data: CreateTodoRequest = Body(),
    user: User = Depends(get_current_active_user),
) -> ResponseModel[TodoItem]:
    if not data.text.strip():
        raise BotApiException(400, "ERR_VALIDATION", "Text cannot be empty.")
    result = create_todo(potential_id, data.text, user.user_id)
    log_activity(potential_id, "todo_created", f"Todo created: \"{data.text}\"", user.user_id)
    return ResponseModel(data=result)


@router.patch("/{todo_id}")
def patch_todo(
    potential_id: str,
    todo_id: int,
    data: UpdateTodoRequest = Body(),
    user: User = Depends(get_current_active_user),
) -> ResponseModel[TodoItem]:
    if data.status not in TODO_STATUSES:
        raise BotApiException(400, "ERR_VALIDATION", f"Invalid status. Must be one of: {', '.join(TODO_STATUSES)}.")
    updated = update_todo(todo_id, data.status)
    if not updated:
        raise BotApiException(404, "ERR_NOT_FOUND", "Todo not found.")
    result, old_status = updated
    old_label = _STATUS_LABELS.get(old_status, old_status)
    new_label = _STATUS_LABELS.get(data.status, data.status)
    log_activity(
        potential_id, "todo_updated",
        f"Todo status: '{old_label}' → '{new_label}': \"{result.text}\"",
        user.user_id,
    )
    return ResponseModel(data=result)


@router.delete("/{todo_id}")
def remove_todo(
    potential_id: str,
    todo_id: int,
    user: User = Depends(get_current_active_user),
) -> ResponseModel[dict]:
    text = delete_todo(todo_id)
    if text is None:
        raise BotApiException(404, "ERR_NOT_FOUND", "Todo not found.")
    log_activity(potential_id, "todo_deleted", f"Todo deleted: \"{text}\"", user.user_id)
    return ResponseModel(data={"ok": True})
