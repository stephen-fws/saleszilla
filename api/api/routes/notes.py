"""Notes CRUD endpoints."""

from fastapi import APIRouter, Body, Depends

from core.auth import get_current_active_user
from core.exceptions import BotApiException
from core.models import User
from core.schemas import CreateNoteRequest, NoteItem, ResponseModel, UpdateNoteRequest
from api.services.note_service import create_note, delete_note, list_notes, update_note
from api.services.activity_service import log_activity
from api.services.access_control import require_potential_owner

router = APIRouter(prefix="/potentials/{potential_id}/notes", tags=["notes"])


@router.get("")
def get_notes(potential_id: str, user: User = Depends(get_current_active_user)) -> ResponseModel[list[NoteItem]]:
    require_potential_owner(user.user_id, potential_id)
    return ResponseModel(data=list_notes(potential_id))


@router.post("")
def post_note(
    potential_id: str,
    data: CreateNoteRequest = Body(),
    user: User = Depends(get_current_active_user),
) -> ResponseModel[NoteItem]:
    require_potential_owner(user.user_id, potential_id)
    if not data.content.strip():
        raise BotApiException(400, "ERR_VALIDATION", "Content cannot be empty.")
    result = create_note(potential_id, data.content, user.user_id)
    preview = (data.content[:80] + "…") if len(data.content) > 83 else data.content
    log_activity(potential_id, "note_added", f"Note added: \"{preview}\"", user.user_id)
    return ResponseModel(data=result)


@router.patch("/{note_id}")
def patch_note(
    potential_id: str,
    note_id: int,
    data: UpdateNoteRequest = Body(),
    user: User = Depends(get_current_active_user),
) -> ResponseModel[NoteItem]:
    require_potential_owner(user.user_id, potential_id)
    if not data.content.strip():
        raise BotApiException(400, "ERR_VALIDATION", "Content cannot be empty.")
    updated = update_note(note_id, data.content)
    if not updated:
        raise BotApiException(404, "ERR_NOT_FOUND", "Note not found.")
    result, old_content = updated

    def _preview(s: str) -> str:
        return (s[:80] + "…") if len(s) > 83 else s

    log_activity(
        potential_id, "note_edited",
        f"Note edited\nBefore: \"{_preview(old_content)}\"\nAfter: \"{_preview(data.content)}\"",
        user.user_id,
    )
    return ResponseModel(data=result)


@router.delete("/{note_id}")
def remove_note(
    potential_id: str,
    note_id: int,
    user: User = Depends(get_current_active_user),
) -> ResponseModel[dict]:
    require_potential_owner(user.user_id, potential_id)
    preview = delete_note(note_id)
    if preview is None:
        raise BotApiException(404, "ERR_NOT_FOUND", "Note not found.")
    log_activity(potential_id, "note_deleted", f"Note deleted: \"{preview}\"", user.user_id)
    return ResponseModel(data={"ok": True})
