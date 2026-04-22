"""Draft attachments — HTML files produced by the attachment agent that get
attached to the NextAction email draft.

Storage layout:
  GCS: {env}/draft-attachments/{potential_number}/{agent_id}_{unix_ts}.html
  DB:  CX_DraftAttachments row with GcsPath + Filename

Lifecycle:
  1. Attachment agent webhook arrives → save_from_agent() writes to GCS + DB
  2. UI loads active attachments via list_active()
  3. User removes in composer → mark_removed() sets IsRemoved=1
  4. User sends → load_for_send() returns base64-encoded payload, mark_sent() flips IsSent=1
"""

import logging
import time
import uuid
from base64 import b64encode
from datetime import datetime, timezone

from google.cloud import storage as gcs
from sqlalchemy import select

import core.config as config
from core.database import get_session
from core.models import CXDraftAttachment

logger = logging.getLogger(__name__)


# ── GCS client (lazy singleton, shared pattern with file_service) ────────────

_gcs_client: "gcs.Client | None" = None


def _get_bucket() -> "gcs.Bucket":
    global _gcs_client
    if _gcs_client is None:
        _gcs_client = gcs.Client()
    return _gcs_client.bucket(config.GCS_BUCKET_NAME)


def _build_path_and_name(potential_number: str, agent_id: str) -> tuple[str, str]:
    """User-visible filename: {potential_number}-{unix_ts}.pdf.
    GCS path uses a short uid prefix so same-second collisions (multiple agents)
    don't overwrite each other.
    """
    ts = int(time.time())
    filename = f"{potential_number}-{ts}.pdf"
    uid = uuid.uuid4().hex[:8]
    path = f"{config.GCS_ENV}/draft-attachments/{potential_number}/{uid}_{filename}"
    # agent_id retained in the signature for future use (e.g. audit logs)
    _ = agent_id
    return path, filename


def _html_to_pdf(html: str) -> bytes | None:
    """Render HTML → PDF bytes using WeasyPrint. Returns None on failure.

    Handles modern CSS (flexbox, grid, :not, ::before/after, media queries) —
    what xhtml2pdf couldn't. Imported lazily so the service boots on machines
    that lack the native GTK libs (production Docker has them; Windows local
    dev needs the GTK3 runtime installer).
    """
    try:
        from weasyprint import HTML  # lazy import
    except Exception:
        logger.exception("draft_attachment: weasyprint import failed — PDF conversion unavailable")
        return None
    try:
        return HTML(string=html).write_pdf()
    except Exception:
        logger.exception("draft_attachment: HTML→PDF render failed")
        return None


# ── Public API ────────────────────────────────────────────────────────────────

def _strip_markdown_fence(content: str) -> str:
    """Strip a leading/trailing ``` fence (optionally with language tag) so raw
    HTML renders as HTML instead of showing literal ```html in the browser.

    Leaves non-fenced content untouched.
    """
    stripped = content.strip()
    if not stripped.startswith("```"):
        return content
    # Drop the first line (```html / ```) and the closing fence if present.
    first_nl = stripped.find("\n")
    if first_nl == -1:
        return content  # single-line fence, nothing we can safely recover
    body = stripped[first_nl + 1:]
    # Trim trailing ```
    if body.rstrip().endswith("```"):
        body = body.rstrip()[:-3]
    return body.strip() + "\n"


def save_from_agent(potential_number: str, agent_id: str, html_content: str) -> int | None:
    """Upload agent HTML to GCS and insert a CX_DraftAttachments row.

    Returns the new row id, or None if GCS upload fails (caller should log).
    Treats empty/whitespace content as "no attachment" and skips silently.
    """
    if not html_content or not html_content.strip():
        logger.info("draft_attachment: skipping empty content for %s/%s", potential_number, agent_id)
        return None

    # Agents sometimes wrap HTML in a markdown fence (```html ... ```). Strip
    # it first so the PDF renderer doesn't see stray backticks on the page.
    html_content = _strip_markdown_fence(html_content)

    # Convert HTML → PDF. If conversion fails (missing native libs, bad HTML),
    # skip the attachment entirely rather than fall back to raw HTML — the
    # product contract here is "attach a PDF".
    pdf_bytes = _html_to_pdf(html_content)
    if not pdf_bytes:
        logger.warning("draft_attachment: skipping — PDF conversion failed for %s/%s", potential_number, agent_id)
        return None

    gcs_path, filename = _build_path_and_name(potential_number, agent_id)

    try:
        bucket = _get_bucket()
        blob = bucket.blob(gcs_path)
        blob.upload_from_string(pdf_bytes, content_type="application/pdf")
        logger.info("draft_attachment: uploaded PDF to GCS %s (%d bytes)", gcs_path, len(pdf_bytes))
    except Exception:
        logger.exception("draft_attachment: GCS upload failed for %s/%s", potential_number, agent_id)
        return None

    now = datetime.now(timezone.utc)
    with get_session() as session:
        row = CXDraftAttachment(
            potential_id=potential_number,
            agent_id=agent_id,
            gcs_path=gcs_path,
            filename=filename,
            content_type="application/pdf",
            file_size=len(pdf_bytes),
            is_removed=False,
            is_sent=False,
            created_time=now,
            updated_time=now,
        )
        session.add(row)
        session.flush()
        return row.id


def list_active(potential_number: str) -> list[dict]:
    """Return active (not removed, not sent) attachments for this potential."""
    with get_session() as session:
        rows = session.execute(
            select(CXDraftAttachment).where(
                CXDraftAttachment.potential_id == potential_number,
                CXDraftAttachment.is_removed == False,
                CXDraftAttachment.is_sent == False,
            ).order_by(CXDraftAttachment.created_time.desc())
        ).scalars().all()
        return [
            {
                "id": r.id,
                "filename": r.filename,
                "content_type": r.content_type,
                "file_size": r.file_size or 0,
                "created_time": r.created_time,
            }
            for r in rows
        ]


def mark_removed(attachment_id: int, potential_number: str) -> bool:
    """Soft-remove an attachment (user clicked X in composer). Does not delete GCS object."""
    now = datetime.now(timezone.utc)
    with get_session() as session:
        row = session.get(CXDraftAttachment, attachment_id)
        if not row or row.potential_id != potential_number:
            return False
        row.is_removed = True
        row.updated_time = now
        session.add(row)
        return True


def load_for_send(potential_number: str) -> list[dict]:
    """Download active attachments from GCS and return Graph-ready payloads.

    Returns a list of dicts matching the email send pipeline's AttachmentItem:
      {"name": str, "content_type": str, "content_bytes": str (base64)}

    Rows that fail to download are skipped and logged — user's email still sends.
    """
    with get_session() as session:
        rows = session.execute(
            select(CXDraftAttachment).where(
                CXDraftAttachment.potential_id == potential_number,
                CXDraftAttachment.is_removed == False,
                CXDraftAttachment.is_sent == False,
            ).order_by(CXDraftAttachment.created_time.asc())
        ).scalars().all()
        # Snapshot fields we need outside the session
        items = [(r.id, r.gcs_path, r.filename, r.content_type) for r in rows]

    if not items:
        return []

    bucket = _get_bucket()
    payloads: list[dict] = []
    for row_id, path, filename, ct in items:
        try:
            blob = bucket.blob(path)
            if not blob.exists():
                logger.warning("draft_attachment: GCS object missing for id=%s path=%s", row_id, path)
                continue
            content = blob.download_as_bytes()
            payloads.append({
                "id": row_id,
                "name": filename,
                "content_type": ct or "text/html",
                "content_bytes": b64encode(content).decode("ascii"),
            })
        except Exception:
            logger.exception("draft_attachment: failed to download id=%s path=%s", row_id, path)
    return payloads


def get_content(attachment_id: int, potential_number: str) -> tuple[bytes, str, str] | None:
    """Download a single attachment from GCS. Returns (content, filename, content_type) or None.

    Verifies potential_number matches so a user can't download another potential's attachment
    by guessing the id.
    """
    with get_session() as session:
        row = session.get(CXDraftAttachment, attachment_id)
        if not row or row.potential_id != potential_number:
            return None
        gcs_path = row.gcs_path
        filename = row.filename
        content_type = row.content_type or "text/html"

    try:
        blob = _get_bucket().blob(gcs_path)
        if not blob.exists():
            logger.warning("draft_attachment: GCS object missing for id=%s path=%s", attachment_id, gcs_path)
            return None
        return blob.download_as_bytes(), filename, content_type
    except Exception:
        logger.exception("draft_attachment: download failed id=%s path=%s", attachment_id, gcs_path)
        return None


def mark_sent(attachment_ids: list[int]) -> None:
    """Flip IsSent=1 after a successful email send."""
    if not attachment_ids:
        return
    now = datetime.now(timezone.utc)
    with get_session() as session:
        rows = session.execute(
            select(CXDraftAttachment).where(CXDraftAttachment.id.in_(attachment_ids))
        ).scalars().all()
        for r in rows:
            r.is_sent = True
            r.updated_time = now
            session.add(r)
