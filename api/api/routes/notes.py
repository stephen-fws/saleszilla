"""Notes CRUD endpoints."""

from fastapi import APIRouter, Body, Depends

from core.auth import get_current_active_user
from core.exceptions import BotApiException
from core.models import User
from core.schemas import CreateNoteRequest, NoteItem, ResponseModel, UpdateNoteRequest
from api.services.note_service import create_note, delete_note, list_notes, update_note

router = APIRouter(prefix="/potentials/{potential_id}/notes", tags=["notes"])


@router.get("")
def get_notes(potential_id: str, user: User = Depends(get_current_active_user)) -> ResponseModel[list[NoteItem]]:
    return ResponseModel(data=list_notes(potential_id))


@router.post("")
def post_note(
    potential_id: str,
    data: CreateNoteRequest = Body(),
    user: User = Depends(get_current_active_user),
) -> ResponseModel[NoteItem]:
    if not data.content.strip():
        raise BotApiException(400, "ERR_VALIDATION", "Content cannot be empty.")
    return ResponseModel(data=create_note(potential_id, data.content, user.user_id))


@router.patch("/{note_id}")
def patch_note(
    note_id: int,
    data: UpdateNoteRequest = Body(),
    user: User = Depends(get_current_active_user),
) -> ResponseModel[NoteItem]:
    if not data.content.strip():
        raise BotApiException(400, "ERR_VALIDATION", "Content cannot be empty.")
    result = update_note(note_id, data.content)
    if not result:
        raise BotApiException(404, "ERR_NOT_FOUND", "Note not found.")
    return ResponseModel(data=result)


@router.delete("/{note_id}")
def remove_note(note_id: int, user: User = Depends(get_current_active_user)) -> ResponseModel[dict]:
    if not delete_note(note_id):
        raise BotApiException(404, "ERR_NOT_FOUND", "Note not found.")
    return ResponseModel(data={"ok": True})
