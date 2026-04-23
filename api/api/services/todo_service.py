"""Todos CRUD on Potentials.

CX_Todos.PotentialId stores the 7-digit potential_number (business key), same
convention as CX_QueueItems / CX_ChatMessages / CX_AgentInsights. Routes
receive the UUID from the UI, so services resolve at the boundary.
"""

import logging
from datetime import datetime, timezone

from sqlalchemy import select

from core.database import get_session
from core.models import CXTodo, Potential
from core.schemas import TodoItem

logger = logging.getLogger(__name__)


def _resolve_potential_number(identifier: str) -> str:
    """Accept either a UUID (from the UI) or a 7-digit potential_number.
    Returns the potential_number, or the identifier unchanged if no match
    (caller will end up with zero results — logged)."""
    if not identifier:
        return identifier
    # If it already looks like a potential_number (digits, ≤ 10 chars) use as-is
    if identifier.isdigit() and len(identifier) <= 10:
        return identifier
    with get_session() as session:
        row = session.execute(
            select(Potential.potential_number).where(Potential.potential_id == identifier)
        ).first()
        if row and row[0]:
            return row[0]
        logger.warning("todo_service: no potential_number for id=%s (treating as raw)", identifier)
        return identifier


def _to_item(t: CXTodo) -> TodoItem:
    return TodoItem(
        id=t.id, potential_id=t.potential_id, text=t.text,
        status=t.status, is_completed=t.is_completed, source=t.source,
        created_by_user_id=t.created_by_user_id, created_time=t.created_time,
    )


def list_todos(potential_id: str) -> list[TodoItem]:
    pn = _resolve_potential_number(potential_id)
    STATUS_ORDER = {"pending": 0, "in_progress": 1, "on_hold": 2, "done": 3}
    with get_session() as session:
        stmt = select(CXTodo).where(
            CXTodo.potential_id == pn,
            CXTodo.is_active == True,
        ).order_by(CXTodo.created_time.desc())
        rows = session.execute(stmt).scalars().all()
        return sorted(
            [_to_item(t) for t in rows],
            key=lambda t: (STATUS_ORDER.get(t.status, 99), 0),
        )


def create_todo(potential_id: str, text: str, user_id: str | None = None) -> TodoItem:
    pn = _resolve_potential_number(potential_id)
    now = datetime.now(timezone.utc)
    with get_session() as session:
        todo = CXTodo(
            potential_id=pn, text=text, status="pending", is_completed=False,
            created_by_user_id=user_id, created_time=now, updated_time=now, is_active=True,
        )
        session.add(todo)
        session.flush()
        session.refresh(todo)
        return _to_item(todo)


def update_todo(todo_id: int, status: str | None = None, text: str | None = None) -> tuple[TodoItem, str] | None:
    """Update todo status and/or text. Returns (updated_item, old_status) or None if not found.

    If the user edits the text of an agent-created todo (source=="agent"), flip
    source to "user" — the reconcile agent will then stop touching this row.
    Status-only changes don't flip source (the agent still wants to see its own
    done/cancelled items in the next reconcile pass so it doesn't re-propose them).
    """
    now = datetime.now(timezone.utc)
    with get_session() as session:
        todo = session.get(CXTodo, todo_id)
        if not todo or not todo.is_active:
            return None
        old_status = todo.status
        if status is not None:
            todo.status = status
            todo.is_completed = status == "done"
        if text is not None and text != todo.text:
            todo.text = text
            if todo.source == "agent":
                todo.source = "user"
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
