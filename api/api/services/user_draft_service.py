"""User-composed email draft service."""

import json
from datetime import datetime, timezone

from sqlalchemy import select

from core.database import get_session
from core.models import CXUserEmailDraft, CXUserToken
from core.schemas import CreateDraftRequest, UpdateDraftRequest, UserEmailDraftItem


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
        created_time=d.created_time,
        updated_time=d.updated_time,
    )


def list_drafts(potential_id: str, user_id: str) -> list[UserEmailDraftItem]:
    with get_session() as session:
        stmt = (
            select(CXUserEmailDraft)
            .where(
                CXUserEmailDraft.potential_id == potential_id,
                CXUserEmailDraft.created_by_user_id == user_id,
                CXUserEmailDraft.status == "draft",
                CXUserEmailDraft.is_active == True,
            )
            .order_by(CXUserEmailDraft.updated_time.desc())
        )
        return [_to_item(d) for d in session.execute(stmt).scalars().all()]


def create_draft(potential_id: str, data: CreateDraftRequest, user_id: str) -> UserEmailDraftItem:
    """Create a new draft, or update the existing one if this user already has a
    draft for this potential. Enforces one-draft-per-potential-per-user so the
    Emails tab never shows duplicates from repeated Save Draft clicks."""
    now = datetime.now(timezone.utc)
    with get_session() as session:
        # Check for an existing active draft for this user + potential
        existing = session.execute(
            select(CXUserEmailDraft)
            .where(
                CXUserEmailDraft.potential_id == potential_id,
                CXUserEmailDraft.created_by_user_id == user_id,
                CXUserEmailDraft.status == "draft",
                CXUserEmailDraft.is_active == True,
            )
            .order_by(CXUserEmailDraft.updated_time.desc())
            .limit(1)
        ).scalar_one_or_none()

        if existing:
            # Update in place rather than creating a duplicate
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
            created_by_user_id=user_id,
            created_time=now,
            updated_time=now,
            is_active=True,
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
