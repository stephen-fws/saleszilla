"""Todos CRUD endpoints."""

from fastapi import APIRouter, Body, Depends

from core.auth import get_current_active_user
from core.exceptions import BotApiException
from core.models import User
from core.schemas import CreateTodoRequest, ResponseModel, TodoItem, TODO_STATUSES, UpdateTodoRequest
from api.services.todo_service import create_todo, delete_todo, list_todos, update_todo

router = APIRouter(prefix="/potentials/{potential_id}/todos", tags=["todos"])


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
    return ResponseModel(data=create_todo(potential_id, data.text, user.user_id))


@router.patch("/{todo_id}")
def patch_todo(
    todo_id: int,
    data: UpdateTodoRequest = Body(),
    user: User = Depends(get_current_active_user),
) -> ResponseModel[TodoItem]:
    if data.status not in TODO_STATUSES:
        raise BotApiException(400, "ERR_VALIDATION", f"Invalid status. Must be one of: {', '.join(TODO_STATUSES)}.")
    result = update_todo(todo_id, data.status)
    if not result:
        raise BotApiException(404, "ERR_NOT_FOUND", "Todo not found.")
    return ResponseModel(data=result)


@router.delete("/{todo_id}")
def remove_todo(todo_id: int, user: User = Depends(get_current_active_user)) -> ResponseModel[dict]:
    if not delete_todo(todo_id):
        raise BotApiException(404, "ERR_NOT_FOUND", "Todo not found.")
    return ResponseModel(data={"ok": True})
