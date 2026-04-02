"""Email draft and send operations."""

from datetime import datetime, timezone

from sqlalchemy import select

from core.database import get_session
from core.models import CXEmailDraft, CXSentEmail, CXActivity
from core.schemas import EmailDraftResponse, SentEmailResponse


def get_email_draft(potential_id: str) -> EmailDraftResponse | None:
    """Get the most recent active draft for a potential."""
    with get_session() as session:
        stmt = select(CXEmailDraft).where(
            CXEmailDraft.potential_id == potential_id,
            CXEmailDraft.status == "draft",
            CXEmailDraft.is_active == True,
        ).order_by(CXEmailDraft.created_time.desc()).limit(1)

        draft = session.execute(stmt).scalar_one_or_none()
        if not draft:
            return None

        return EmailDraftResponse(
            id=draft.id, potential_id=draft.potential_id,
            to_email=draft.to_email, subject=draft.subject,
            body=draft.body, status=draft.status,
        )


def save_email_draft(
    potential_id: str,
    to_email: str | None,
    subject: str | None,
    body: str | None,
    queue_item_id: int | None = None,
    user_id: str | None = None,
) -> EmailDraftResponse:
    """Create a new email draft."""
    now = datetime.now(timezone.utc)
    with get_session() as session:
        draft = CXEmailDraft(
            potential_id=potential_id, queue_item_id=queue_item_id,
            to_email=to_email, subject=subject, body=body, status="draft",
            created_by_user_id=user_id, created_time=now, updated_time=now, is_active=True,
        )
        session.add(draft)
        session.flush()
        session.refresh(draft)
        return EmailDraftResponse(
            id=draft.id, potential_id=draft.potential_id,
            to_email=draft.to_email, subject=draft.subject,
            body=draft.body, status=draft.status,
        )


def record_sent_email(
    potential_id: str,
    from_email: str,
    from_name: str | None,
    to_email: str,
    to_name: str | None,
    subject: str,
    body: str,
    thread_id: str | None = None,
    draft_id: int | None = None,
    contact_id: str | None = None,
    account_id: str | None = None,
    user_id: str | None = None,
) -> SentEmailResponse:
    """Record a sent email and log activity."""
    now = datetime.now(timezone.utc)
    with get_session() as session:
        sent = CXSentEmail(
            potential_id=potential_id, contact_id=contact_id, account_id=account_id,
            draft_id=draft_id, from_email=from_email, from_name=from_name,
            to_email=to_email, to_name=to_name, subject=subject, body=body,
            thread_id=thread_id, sent_by_user_id=user_id, sent_time=now,
            created_time=now, updated_time=now, is_active=True,
        )
        session.add(sent)

        # Mark draft as sent if provided
        if draft_id:
            draft = session.get(CXEmailDraft, draft_id)
            if draft:
                draft.status = "sent"
                draft.updated_time = now
                session.add(draft)

        # Log activity
        activity = CXActivity(
            potential_id=potential_id, contact_id=contact_id, account_id=account_id,
            activity_type="email_sent",
            description=f"Email sent to {to_email}: {subject[:80]}",
            performed_by_user_id=user_id, created_time=now, updated_time=now, is_active=True,
        )
        session.add(activity)

        session.flush()
        session.refresh(sent)
        return SentEmailResponse(
            id=sent.id, to_email=sent.to_email, subject=sent.subject,
            sent_time=sent.sent_time, thread_id=sent.thread_id,
        )
