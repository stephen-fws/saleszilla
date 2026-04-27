"""User-composed email draft service."""

import json
from datetime import datetime, timezone

from sqlalchemy import select

from core.database import get_session
from core.models import CXUserEmailDraft, CXUserToken
from core.schemas import CreateDraftRequest, DraftAttachmentInline, UpdateDraftRequest, UserEmailDraftItem


def _decode_attachments(raw: str | None) -> list[DraftAttachmentInline] | None:
    """Parse the JSON-encoded attachments column. Returns None if absent or
    malformed — never raises, so a corrupt row doesn't break draft loading."""
    if not raw:
        return None
    try:
        items = json.loads(raw)
    except Exception:
        return None
    if not isinstance(items, list):
        return None
    out: list[DraftAttachmentInline] = []
    for it in items:
        if not isinstance(it, dict):
            continue
        try:
            out.append(DraftAttachmentInline(
                name=it.get("name", ""),
                content_type=it.get("content_type", "application/octet-stream"),
                content_bytes=it.get("content_bytes", ""),
                size_bytes=int(it.get("size_bytes", 0) or 0),
            ))
        except Exception:
            continue
    return out or None


def _encode_attachments(items: list[DraftAttachmentInline] | None) -> str | None:
    """Serialise to the column. Empty list → NULL so we don't waste space."""
    if not items:
        return None
    return json.dumps([
        {
            "name": a.name,
            "content_type": a.content_type,
            "content_bytes": a.content_bytes,
            "size_bytes": a.size_bytes,
        }
        for a in items
    ])


def _to_item(d: CXUserEmailDraft) -> UserEmailDraftItem:
    return UserEmailDraftItem(
        id=d.id,
        potential_id=d.potential_id,
        to_email=d.to_email,
        to_name=d.to_name,
        cc_emails=json.loads(d.cc_emails) if d.cc_emails else None,
        bcc_emails=json.loads(d.bcc_emails) if d.bcc_emails else None,
        subject=d.subject,
        body=d.body,
        reply_to_thread_id=d.reply_to_thread_id,
        reply_to_message_id=d.reply_to_message_id,
        status=d.status,
        attachments=_decode_attachments(d.attachments),
        created_time=d.created_time,
        updated_time=d.updated_time,
    )


def list_drafts(potential_id: str, user_id: str, is_next_action: bool = False) -> list[UserEmailDraftItem]:
    """List drafts. is_next_action=False (default) returns Email-tab drafts only.
    is_next_action=True returns Next-Action drafts only."""
    with get_session() as session:
        stmt = (
            select(CXUserEmailDraft)
            .where(
                CXUserEmailDraft.potential_id == potential_id,
                CXUserEmailDraft.created_by_user_id == user_id,
                CXUserEmailDraft.status == "draft",
                CXUserEmailDraft.is_active == True,
                CXUserEmailDraft.is_next_action == is_next_action,
            )
            .order_by(CXUserEmailDraft.updated_time.desc())
        )
        return [_to_item(d) for d in session.execute(stmt).scalars().all()]


def create_draft(potential_id: str, data: CreateDraftRequest, user_id: str, is_next_action: bool = False) -> UserEmailDraftItem:
    """Create a new draft, or update the existing one if this user already has a
    draft for this potential+source. Enforces one-draft-per-potential-per-user-per-source."""
    now = datetime.now(timezone.utc)
    with get_session() as session:
        existing = session.execute(
            select(CXUserEmailDraft)
            .where(
                CXUserEmailDraft.potential_id == potential_id,
                CXUserEmailDraft.created_by_user_id == user_id,
                CXUserEmailDraft.status == "draft",
                CXUserEmailDraft.is_active == True,
                CXUserEmailDraft.is_next_action == is_next_action,
            )
            .order_by(CXUserEmailDraft.updated_time.desc())
            .limit(1)
        ).scalar_one_or_none()

        if existing:
            if data.to_email is not None:
                existing.to_email = data.to_email
            if data.to_name is not None:
                existing.to_name = data.to_name
            if data.cc_emails is not None:
                existing.cc_emails = json.dumps(data.cc_emails)
            if data.bcc_emails is not None:
                existing.bcc_emails = json.dumps(data.bcc_emails)
            if data.subject is not None:
                existing.subject = data.subject
            if data.body is not None:
                existing.body = data.body
            if data.attachments is not None:
                # Treat as full overwrite: the client always sends the
                # complete current attachment list, including after removals.
                existing.attachments = _encode_attachments(data.attachments)
            existing.updated_time = now
            session.add(existing)
            session.flush()
            session.refresh(existing)
            return _to_item(existing)

        draft = CXUserEmailDraft(
            potential_id=potential_id,
            to_email=data.to_email,
            to_name=data.to_name,
            cc_emails=json.dumps(data.cc_emails) if data.cc_emails else None,
            bcc_emails=json.dumps(data.bcc_emails) if data.bcc_emails else None,
            subject=data.subject,
            body=data.body,
            reply_to_thread_id=data.reply_to_thread_id,
            reply_to_message_id=data.reply_to_message_id,
            status="draft",
            attachments=_encode_attachments(data.attachments),
            created_by_user_id=user_id,
            created_time=now,
            updated_time=now,
            is_active=True,
            is_next_action=is_next_action,
        )
        session.add(draft)
        session.flush()
        session.refresh(draft)
        return _to_item(draft)


def update_draft(draft_id: int, data: UpdateDraftRequest, user_id: str) -> UserEmailDraftItem | None:
    now = datetime.now(timezone.utc)
    with get_session() as session:
        draft = session.get(CXUserEmailDraft, draft_id)
        if not draft or not draft.is_active or draft.created_by_user_id != user_id:
            return None
        if data.to_email is not None: draft.to_email = data.to_email
        if data.to_name is not None: draft.to_name = data.to_name
        if data.cc_emails is not None: draft.cc_emails = json.dumps(data.cc_emails)
        if data.bcc_emails is not None: draft.bcc_emails = json.dumps(data.bcc_emails)
        if data.subject is not None: draft.subject = data.subject
        if data.body is not None: draft.body = data.body
        if data.attachments is not None: draft.attachments = _encode_attachments(data.attachments)
        draft.updated_time = now
        session.add(draft)
        session.flush()
        session.refresh(draft)
        return _to_item(draft)


def delete_draft(draft_id: int, user_id: str) -> bool:
    now = datetime.now(timezone.utc)
    with get_session() as session:
        draft = session.get(CXUserEmailDraft, draft_id)
        if not draft or not draft.is_active or draft.created_by_user_id != user_id:
            return False
        draft.is_active = False
        draft.updated_time = now
        session.add(draft)
    return True


def mark_draft_sent(draft_id: int) -> None:
    now = datetime.now(timezone.utc)
    with get_session() as session:
        draft = session.get(CXUserEmailDraft, draft_id)
        if draft and draft.is_active:
            draft.status = "sent"
            draft.updated_time = now
            session.add(draft)


def get_signature(user_id: str) -> str | None:
    with get_session() as session:
        stmt = select(CXUserToken).where(
            CXUserToken.user_id == user_id,
            CXUserToken.is_active == True,
        ).limit(1)
        token = session.execute(stmt).scalar_one_or_none()
        return token.email_signature if token else None


def save_signature(user_id: str, signature: str | None) -> None:
    now = datetime.now(timezone.utc)
    with get_session() as session:
        stmt = select(CXUserToken).where(
            CXUserToken.user_id == user_id,
            CXUserToken.is_active == True,
        ).limit(1)
        token = session.execute(stmt).scalar_one_or_none()
        if token:
            token.email_signature = signature
            token.updated_time = now
            session.add(token)
