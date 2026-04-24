"""Notes CRUD on Potentials.

CX_Notes.PotentialId stores the 7-digit potential_number (business key), same
convention as CX_QueueItems / CX_Todos / CX_AgentInsights. Routes receive the
UUID from the UI, so services resolve at the boundary.
"""

import logging
from datetime import datetime, timezone

from sqlalchemy import select

from core.database import get_session
from core.models import CXNote, Potential
from core.schemas import NoteItem

logger = logging.getLogger(__name__)


def _resolve_potential_number(identifier: str) -> str:
    """UUID (from UI) → 7-digit potential_number. Returns identifier unchanged
    if it already looks like a potential_number."""
    if not identifier:
        return identifier
    if identifier.isdigit() and len(identifier) <= 10:
        return identifier
    with get_session() as session:
        row = session.execute(
            select(Potential.potential_number).where(Potential.potential_id == identifier)
        ).first()
        if row and row[0]:
            return row[0]
        logger.warning("note_service: no potential_number for id=%s (treating as raw)", identifier)
        return identifier


def list_notes(potential_id: str) -> list[NoteItem]:
    pn = _resolve_potential_number(potential_id)
    with get_session() as session:
        stmt = select(CXNote).where(
            CXNote.potential_id == pn,
            CXNote.is_active == True,
        ).order_by(CXNote.created_time.desc())
        return [
            NoteItem(id=n.id, potential_id=n.potential_id, content=n.content,
                     created_by_user_id=n.created_by_user_id, created_time=n.created_time)
            for n in session.execute(stmt).scalars().all()
        ]


def create_note(potential_id: str, content: str, user_id: str | None = None) -> NoteItem:
    pn = _resolve_potential_number(potential_id)
    now = datetime.now(timezone.utc)
    with get_session() as session:
        note = CXNote(
            potential_id=pn, content=content,
            created_by_user_id=user_id, created_time=now, updated_time=now, is_active=True,
        )
        session.add(note)
        session.flush()
        session.refresh(note)
        return NoteItem(id=note.id, potential_id=note.potential_id, content=note.content,
                        created_by_user_id=note.created_by_user_id, created_time=note.created_time)


def update_note(note_id: int, content: str) -> tuple[NoteItem, str] | None:
    """Update note content. Returns (updated_item, old_content) or None if not found."""
    now = datetime.now(timezone.utc)
    with get_session() as session:
        note = session.get(CXNote, note_id)
        if not note or not note.is_active:
            return None
        old_content = note.content
        note.content = content
        note.updated_time = now
        session.add(note)
        session.flush()
        session.refresh(note)
        return (
            NoteItem(id=note.id, potential_id=note.potential_id, content=note.content,
                     created_by_user_id=note.created_by_user_id, created_time=note.created_time),
            old_content,
        )


def delete_note(note_id: int) -> str | None:
    """Soft-delete a note. Returns a preview of the content on success, None if not found."""
    now = datetime.now(timezone.utc)
    with get_session() as session:
        note = session.get(CXNote, note_id)
        if not note or not note.is_active:
            return None
        preview = (note.content[:80] + "…") if len(note.content) > 83 else note.content
        note.is_active = False
        note.updated_time = now
        session.add(note)
    return preview
