"""Email draft and send operations."""

from datetime import datetime, timezone

from sqlalchemy import select

from core.database import get_session
from core.models import Account, CXEmailDraft, CXSentEmail, CXActivity, CXQueueItem, Contact, Potential
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
    cc_emails: str | None = None,   # comma-separated CC addresses
    bcc_emails: str | None = None,  # comma-separated BCC addresses
    thread_id: str | None = None,
    internet_message_id: str | None = None,
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
            to_email=to_email, to_name=to_name,
            cc_emails=cc_emails, bcc_emails=bcc_emails,
            subject=subject, body=body,
            thread_id=thread_id, internet_message_id=internet_message_id,
            sent_by_user_id=user_id, sent_time=now,
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

        # Resolve potential_number — CXQueueItem stores 7-digit number, not UUID
        pn = session.execute(
            select(Potential.potential_number).where(Potential.potential_id == potential_id)
        ).scalar_one_or_none() or potential_id

        # Add to "Emails Sent" queue folder — upsert so one potential appears at most once.
        existing_sent_item = session.execute(
            select(CXQueueItem).where(
                CXQueueItem.potential_id == pn,
                CXQueueItem.folder_type == "emails-sent",
                CXQueueItem.status == "pending",
                CXQueueItem.is_active == True,
            ).limit(1)
        ).scalar_one_or_none()

        if existing_sent_item:
            existing_sent_item.preview = subject[:200] if subject else existing_sent_item.preview
            existing_sent_item.time_label = now.strftime("%Y-%m-%d")
            existing_sent_item.updated_time = now
            session.add(existing_sent_item)
        else:
            potential_row = session.execute(
                select(Potential, Account, Contact)
                .outerjoin(Account, Potential.account_id == Account.account_id)
                .outerjoin(Contact, Potential.contact_id == Contact.contact_id)
                .where(Potential.potential_id == potential_id)
            ).first()
            if potential_row:
                p, a, c = potential_row
                deal_title = p.potential_name or "(untitled)"
                company = a.account_name if a else None
                contact_name = c.full_name if c else None
                parts = [x for x in [company, contact_name] if x]
                deal_subtitle = " · ".join(parts) if parts else to_email
            else:
                deal_title = subject[:200] if subject else "(no subject)"
                deal_subtitle = to_email

            session.add(CXQueueItem(
                potential_id=pn,
                contact_id=contact_id,
                account_id=account_id,
                folder_type="emails-sent",
                title=deal_title,
                subtitle=deal_subtitle,
                preview=subject[:200] if subject else None,
                time_label=now.strftime("%Y-%m-%d"),
                priority="normal",
                status="pending",
                assigned_to_user_id=user_id,
                created_time=now,
                updated_time=now,
                is_active=True,
            ))

        # Complete any pending "new-inquiries" queue item for this potential
        new_inquiry = session.execute(
            select(CXQueueItem).where(
                CXQueueItem.potential_id == pn,
                CXQueueItem.folder_type == "new-inquiries",
                CXQueueItem.status == "pending",
                CXQueueItem.is_active == True,
            ).limit(1)
        ).scalar_one_or_none()
        if new_inquiry:
            new_inquiry.status = "completed"
            new_inquiry.updated_time = now
            session.add(new_inquiry)

        # Next Action insights are NOT marked actioned here — email sends from the
        # Email tab are independent of the AI-suggested next action. The user clears
        # Next Action explicitly via Skip/Done buttons on the Next Action tab.

        session.flush()
        session.refresh(sent)
        return SentEmailResponse(
            id=sent.id, to_email=sent.to_email, subject=sent.subject,
            sent_time=sent.sent_time, thread_id=sent.thread_id,
        )
