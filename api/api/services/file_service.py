"""File upload/download/delete on Potentials — backed by Google Cloud Storage."""

import logging
import re
import uuid
from datetime import datetime, timedelta, timezone

from google.cloud import storage as gcs
from sqlalchemy import select

import core.config as config
from core.database import get_session
from core.models import CXFile
from core.schemas import FileItem

logger = logging.getLogger(__name__)

MAX_FILE_SIZE = 25 * 1024 * 1024  # 25MB
SIGNED_URL_TTL = timedelta(minutes=30)


# ── GCS client (lazy singleton) ───────────────────────────────────────────────

_gcs_client: "gcs.Client | None" = None


def _get_bucket() -> "gcs.Bucket":
    global _gcs_client
    if _gcs_client is None:
        _gcs_client = gcs.Client()
    return _gcs_client.bucket(config.GCS_BUCKET_NAME)


# ── Path helpers ──────────────────────────────────────────────────────────────

def _gcs_path(potential_id: str, file_name: str) -> str:
    """Build GCS object path: {env}/potentials/{potential_id}/{uuid8}_{safe_name}"""
    safe_name = re.sub(r"[^\w.\-]", "_", file_name)
    uid = uuid.uuid4().hex[:8]
    return f"{config.GCS_ENV}/potentials/{potential_id}/{uid}_{safe_name}"


def _signed_url(blob: "gcs.Blob", file_name: str) -> str:
    return blob.generate_signed_url(
        version="v4",
        expiration=SIGNED_URL_TTL,
        method="GET",
        response_disposition=f'attachment; filename="{file_name}"',
    )


def _to_item(f: CXFile, include_url: bool = False) -> FileItem:
    url = None
    if include_url and f.storage_path:
        try:
            blob = _get_bucket().blob(f.storage_path)
            url = _signed_url(blob, f.file_name)
        except Exception:
            logger.warning("Could not generate signed URL for file %s", f.id)
    return FileItem(
        id=f.id, potential_id=f.potential_id, file_name=f.file_name,
        mime_type=f.mime_type, file_size=f.file_size,
        created_time=f.created_time, download_url=url,
    )


# ── Service functions ─────────────────────────────────────────────────────────

def list_files(potential_id: str) -> list[FileItem]:
    with get_session() as session:
        stmt = select(CXFile).where(
            CXFile.potential_id == potential_id,
            CXFile.is_active == True,
        ).order_by(CXFile.created_time.desc())
        rows = list(session.execute(stmt).scalars().all())
        for row in rows:
            session.expunge(row)
    return [_to_item(f, include_url=True) for f in rows]


def save_file(
    potential_id: str,
    file_name: str,
    file_content: bytes,
    mime_type: str | None,
    user_id: str | None = None,
) -> FileItem:
    now = datetime.now(timezone.utc)
    gcs_path = _gcs_path(potential_id, file_name)

    # Upload to GCS
    bucket = _get_bucket()
    blob = bucket.blob(gcs_path)
    blob.upload_from_string(file_content, content_type=mime_type or "application/octet-stream")
    logger.info("Uploaded file to GCS: %s", gcs_path)

    # Save metadata to DB
    with get_session() as session:
        db_file = CXFile(
            potential_id=potential_id,
            file_name=file_name,
            mime_type=mime_type,
            file_size=len(file_content),
            storage_path=gcs_path,
            uploaded_by_user_id=user_id,
            created_time=now,
            updated_time=now,
            is_active=True,
        )
        session.add(db_file)
        session.flush()
        session.refresh(db_file)
        session.expunge(db_file)

    url = _signed_url(blob, file_name)
    return FileItem(
        id=db_file.id, potential_id=db_file.potential_id, file_name=db_file.file_name,
        mime_type=db_file.mime_type, file_size=db_file.file_size,
        created_time=db_file.created_time, download_url=url,
    )


def get_download_url(file_id: int) -> tuple[str, str] | None:
    """Returns (signed_url, file_name) or None."""
    with get_session() as session:
        f = session.get(CXFile, file_id)
        if not f or not f.is_active:
            return None
        gcs_path = f.storage_path
        file_name = f.file_name

    blob = _get_bucket().blob(gcs_path)
    if not blob.exists():
        return None
    url = _signed_url(blob, file_name)
    return url, file_name


def get_file_content(file_id: int) -> tuple[bytes, str, str] | None:
    """Download raw bytes from GCS. Returns (content, file_name, mime_type) or None."""
    with get_session() as session:
        f = session.get(CXFile, file_id)
        if not f or not f.is_active:
            return None
        gcs_path = f.storage_path
        file_name = f.file_name
        mime_type = f.mime_type or "application/octet-stream"

    blob = _get_bucket().blob(gcs_path)
    if not blob.exists():
        return None
    content = blob.download_as_bytes()
    return content, file_name, mime_type


def delete_file(file_id: int) -> bool:
    now = datetime.now(timezone.utc)
    gcs_path = None
    with get_session() as session:
        f = session.get(CXFile, file_id)
        if not f or not f.is_active:
            return False
        gcs_path = f.storage_path
        f.is_active = False
        f.updated_time = now
        session.add(f)

    # Delete from GCS
    if gcs_path:
        try:
            _get_bucket().blob(gcs_path).delete()
            logger.info("Deleted GCS object: %s", gcs_path)
        except Exception:
            logger.warning("Could not delete GCS object: %s", gcs_path)
    return True
