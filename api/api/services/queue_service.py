"""Queue/folder operations."""

from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select

from core.database import get_session
from core.models import Account, Contact, CXQueueItem, Potential
from core.schemas import FolderItem, QueueItemResponse


FOLDER_CONFIG = {
    "meeting-briefs": {"label": "Meeting Prep", "icon": "calendarCheck"},
    "new-inquiries": {"label": "New inquiries", "icon": "inbox"},
    "reply": {"label": "Reply", "icon": "reply"},
    "follow-up-active": {"label": "Follow up active", "icon": "refreshCw"},
    "follow-up-inactive": {"label": "Follow up inactive", "icon": "clock"},
    "news": {"label": "News", "icon": "newspaper"},
    "emails-sent": {"label": "Emails sent", "icon": "send"},
}


def list_folders(user_id: str | None = None) -> list[FolderItem]:
    """Get folder list with pending item counts."""
    with get_session() as session:
        stmt = select(
            CXQueueItem.folder_type,
            func.count(CXQueueItem.id).label("cnt"),
        ).where(
            CXQueueItem.status == "pending",
            CXQueueItem.is_active == True,
        )

        if user_id:
            stmt = stmt.where(CXQueueItem.assigned_to_user_id == user_id)

        stmt = stmt.group_by(CXQueueItem.folder_type)
        rows = {r[0]: r[1] for r in session.execute(stmt).all()}

    folders = []
    for folder_id, cfg in FOLDER_CONFIG.items():
        folders.append(FolderItem(
            id=folder_id,
            label=cfg["label"],
            icon=cfg["icon"],
            count=rows.get(folder_id, 0),
        ))
    return folders


def _potential_category(potential: Potential | None) -> str | None:
    if not potential:
        return None
    if potential.potential2close == 1:
        return "Diamond"
    if (potential.hot_potential or "").lower() == "true":
        return "Platinum"
    return None


def _expire_meeting_briefs(session) -> None:
    """Auto-complete meeting-brief queue items where the LATEST meeting for
    that potential has ended 1+ hours ago. Avoids killing current meetings
    when a potential has multiple meetings (old + upcoming)."""
    from core.models import CXMeeting, CXAgentInsight, CXAgentTypeConfig
    from sqlalchemy import func as sqlfunc
    now = datetime.utcnow()
    cutoff = now - timedelta(hours=1)

    # Find pending meeting-brief queue items
    pending_qis = session.execute(
        select(CXQueueItem).where(
            CXQueueItem.folder_type == "meeting-briefs",
            CXQueueItem.status == "pending",
            CXQueueItem.is_active == True,
        )
    ).scalars().all()
    if not pending_qis:
        return

    expired_qis = []
    for qi in pending_qis:
        # Get the LATEST meeting end_time for this potential
        latest_end = session.execute(
            select(sqlfunc.max(CXMeeting.end_time))
            .join(Potential, CXMeeting.potential_id == Potential.potential_id)
            .where(
                Potential.potential_number == qi.potential_id,
                CXMeeting.is_active == True,
                CXMeeting.end_time.isnot(None),
            )
        ).scalar()
        if latest_end and latest_end < cutoff:
            qi.status = "completed"
            qi.updated_time = now
            expired_qis.append(qi)

    # Mark meeting_brief next_action insights as actioned for expired potentials.
    # Meeting brief is additive (never skipped prior non-MB actions at fire time),
    # so expiry only affects its own insight row + its own queue item. Any FRE /
    # FU / reply that was pending alongside is unaffected and resumes visibility.
    if expired_qis:
        mb_agent_ids = set(session.execute(
            select(CXAgentTypeConfig.agent_id).where(
                CXAgentTypeConfig.trigger_category == "meeting_brief",
                CXAgentTypeConfig.is_active == True,
            )
        ).scalars().all())
        if mb_agent_ids:
            expired_pns = {qi.potential_id for qi in expired_qis}
            insights = session.execute(
                select(CXAgentInsight).where(
                    CXAgentInsight.potential_id.in_(expired_pns),
                    CXAgentInsight.agent_id.in_(mb_agent_ids),
                    CXAgentInsight.status != "actioned",
                    CXAgentInsight.is_active == True,
                )
            ).scalars().all()
            for ins in insights:
                ins.status = "actioned"
                ins.updated_time = now


def list_queue_items(
    folder_type: str,
    user_id: str | None = None,
) -> list[QueueItemResponse]:
    """Get queue items for a specific folder."""
    with get_session() as session:
        # Auto-expire old meeting briefs before listing
        if folder_type == "meeting-briefs":
            _expire_meeting_briefs(session)

        # All folders: join with Potential/Account/Contact to render
        # identical cards to the Potentials list view.
        # CXQueueItem.potential_id stores 7-digit potential_number.
        stmt = (
            select(CXQueueItem, Potential, Account, Contact)
            .outerjoin(Potential, CXQueueItem.potential_id == Potential.potential_number)
            .outerjoin(Account, Potential.account_id == Account.account_id)
            .outerjoin(Contact, Potential.contact_id == Contact.contact_id)
            .where(
                CXQueueItem.folder_type == folder_type,
                CXQueueItem.status == "pending",
                CXQueueItem.is_active == True,
            )
            .order_by(CXQueueItem.created_time.desc())
        )
        if user_id:
            stmt = stmt.where(CXQueueItem.assigned_to_user_id == user_id)

        rows = session.execute(stmt).all()
        result = []
        for item, p, a, c in rows:
            deal_title = (p.potential_name if p else None) or item.title or "(untitled)"
            company = a.account_name if a else None
            contact_name = c.full_name if c else None
            parts = [x for x in [company, contact_name] if x]
            subtitle = " · ".join(parts) if parts else (item.subtitle or "")
            result.append(QueueItemResponse(
                id=item.id,
                potential_id=p.potential_id if p else item.potential_id,
                contact_id=item.contact_id,
                account_id=item.account_id,
                folder_type=item.folder_type,
                title=deal_title,
                subtitle=subtitle,
                preview=item.preview,
                time_label=item.time_label,
                priority=item.priority,
                status=item.status,
                created_time=item.created_time,
                stage=p.stage if p else None,
                value=float(p.amount) if p and p.amount else None,
                service=p.service if p else None,
                category=_potential_category(p),
            ))
        return result


RESOLVED_STATUSES = {"completed", "skipped"}


def resolve_queue_item(item_id: int, status: str) -> bool:
    """Mark a queue item as resolved with the given terminal status.

    Allowed statuses:
      - 'completed' — user acted on the AI suggestion (FRE sent, todo done, etc.)
      - 'skipped'   — user dismissed the AI suggestion as not needed
    Both remove the item from the active queue but preserve the distinction
    so we can later analyze how often each AI item type is used vs ignored.
    """
    if status not in RESOLVED_STATUSES:
        return False
    now = datetime.now(timezone.utc)
    with get_session() as session:
        item = session.get(CXQueueItem, item_id)
        if not item:
            return False
        item.status = status
        item.updated_time = now
        session.add(item)
    return True


def complete_queue_item(item_id: int) -> bool:
    """Backwards-compatible alias — marks as 'completed'."""
    return resolve_queue_item(item_id, "completed")


