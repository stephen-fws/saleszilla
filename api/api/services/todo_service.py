"""Todos CRUD on Potentials."""

from datetime import datetime, timezone

from sqlalchemy import select

from core.database import get_session
from core.models import CXTodo
from core.schemas import TodoItem


def _to_item(t: CXTodo) -> TodoItem:
    return TodoItem(
        id=t.id, potential_id=t.potential_id, text=t.text,
        status=t.status, is_completed=t.is_completed,
        created_by_user_id=t.created_by_user_id, created_time=t.created_time,
    )


def list_todos(potential_id: str) -> list[TodoItem]:
    STATUS_ORDER = {"pending": 0, "in_progress": 1, "on_hold": 2, "done": 3}
    with get_session() as session:
        stmt = select(CXTodo).where(
            CXTodo.potential_id == potential_id,
            CXTodo.is_active == True,
        ).order_by(CXTodo.created_time.desc())
        rows = session.execute(stmt).scalars().all()
        return sorted(
            [_to_item(t) for t in rows],
            key=lambda t: (STATUS_ORDER.get(t.status, 99), 0),
        )


def create_todo(potential_id: str, text: str, user_id: str | None = None) -> TodoItem:
    now = datetime.now(timezone.utc)
    with get_session() as session:
        todo = CXTodo(
            potential_id=potential_id, text=text, status="pending", is_completed=False,
            created_by_user_id=user_id, created_time=now, updated_time=now, is_active=True,
        )
        session.add(todo)
        session.flush()
        session.refresh(todo)
        return _to_item(todo)


def update_todo(todo_id: int, status: str) -> tuple[TodoItem, str] | None:
    """Update todo status. Returns (updated_item, old_status) or None if not found."""
    now = datetime.now(timezone.utc)
    with get_session() as session:
        todo = session.get(CXTodo, todo_id)
        if not todo or not todo.is_active:
            return None
        old_status = todo.status
        todo.status = status
        todo.is_completed = status == "done"
        todo.updated_time = now
        session.add(todo)
        session.flush()
        session.refresh(todo)
        return _to_item(todo), old_status


def delete_todo(todo_id: int) -> str | None:
    """Soft-delete a todo. Returns its text on success, None if not found."""
    now = datetime.now(timezone.utc)
    with get_session() as session:
        todo = session.get(CXTodo, todo_id)
        if not todo or not todo.is_active:
            return None
        text = todo.text
        todo.is_active = False
        todo.updated_time = now
        session.add(todo)
    return text
