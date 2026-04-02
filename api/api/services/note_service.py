"""Notes CRUD on Potentials."""

from datetime import datetime, timezone

from sqlalchemy import select

from core.database import get_session
from core.models import CXNote
from core.schemas import NoteItem


def list_notes(potential_id: str) -> list[NoteItem]:
    with get_session() as session:
        stmt = select(CXNote).where(
            CXNote.potential_id == potential_id,
            CXNote.is_active == True,
        ).order_by(CXNote.created_time.desc())
        return [
            NoteItem(id=n.id, potential_id=n.potential_id, content=n.content,
                     created_by_user_id=n.created_by_user_id, created_time=n.created_time)
            for n in session.execute(stmt).scalars().all()
        ]


def create_note(potential_id: str, content: str, user_id: str | None = None) -> NoteItem:
    now = datetime.now(timezone.utc)
    with get_session() as session:
        note = CXNote(
            potential_id=potential_id, content=content,
            created_by_user_id=user_id, created_time=now, updated_time=now, is_active=True,
        )
        session.add(note)
        session.flush()
        session.refresh(note)
        return NoteItem(id=note.id, potential_id=note.potential_id, content=note.content,
                        created_by_user_id=note.created_by_user_id, created_time=note.created_time)


def update_note(note_id: int, content: str) -> NoteItem | None:
    now = datetime.now(timezone.utc)
    with get_session() as session:
        note = session.get(CXNote, note_id)
        if not note or not note.is_active:
            return None
        note.content = content
        note.updated_time = now
        session.add(note)
        session.flush()
        session.refresh(note)
        return NoteItem(id=note.id, potential_id=note.potential_id, content=note.content,
                        created_by_user_id=note.created_by_user_id, created_time=note.created_time)


def delete_note(note_id: int) -> bool:
    now = datetime.now(timezone.utc)
    with get_session() as session:
        note = session.get(CXNote, note_id)
        if not note or not note.is_active:
            return False
        note.is_active = False
        note.updated_time = now
        session.add(note)
    return True
