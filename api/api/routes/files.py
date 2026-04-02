"""File upload/download/delete endpoints — GCS backed."""

from fastapi import APIRouter, Depends, UploadFile, File as FastAPIFile
from fastapi.responses import RedirectResponse, Response

from core.auth import get_current_active_user
from core.exceptions import BotApiException
from core.models import User
from core.schemas import FileItem, ResponseModel
from api.services.file_service import delete_file, get_download_url, get_file_content, list_files, save_file, MAX_FILE_SIZE

router = APIRouter(prefix="/potentials/{potential_id}/files", tags=["files"])


@router.get("")
def get_files(potential_id: str, user: User = Depends(get_current_active_user)) -> ResponseModel[list[FileItem]]:
    return ResponseModel(data=list_files(potential_id))


@router.post("")
async def upload_file(
    potential_id: str,
    file: UploadFile = FastAPIFile(...),
    user: User = Depends(get_current_active_user),
) -> ResponseModel[FileItem]:
    if not file.filename:
        raise BotApiException(400, "ERR_VALIDATION", "No file provided.")

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise BotApiException(400, "ERR_FILE_TOO_LARGE", "File exceeds 25MB limit.")

    result = save_file(
        potential_id=potential_id,
        file_name=file.filename,
        file_content=content,
        mime_type=file.content_type,
        user_id=user.user_id,
    )
    return ResponseModel(data=result)


@router.get("/{file_id}/download")
def download_file(file_id: int, user: User = Depends(get_current_active_user)):
    """Redirect to a short-lived GCS signed URL."""
    result = get_download_url(file_id)
    if not result:
        raise BotApiException(404, "ERR_NOT_FOUND", "File not found.")
    signed_url, _ = result
    return RedirectResponse(url=signed_url)


@router.get("/{file_id}/content")
def stream_file_content(file_id: int, user: User = Depends(get_current_active_user)):
    """Stream raw file bytes from GCS — used for text/code preview in the browser."""
    result = get_file_content(file_id)
    if not result:
        raise BotApiException(404, "ERR_NOT_FOUND", "File not found.")
    content, file_name, mime_type = result
    headers = {"Content-Disposition": f'inline; filename="{file_name}"'}
    return Response(content=content, media_type=mime_type, headers=headers)


@router.delete("/{file_id}")
def remove_file(file_id: int, user: User = Depends(get_current_active_user)) -> ResponseModel[dict]:
    if not delete_file(file_id):
        raise BotApiException(404, "ERR_NOT_FOUND", "File not found.")
    return ResponseModel(data={"ok": True})
