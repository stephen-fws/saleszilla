"""Queue/folder operations."""

from datetime import datetime, timezone

from sqlalchemy import func, select

from core.database import get_session
from core.models import CXQueueItem
from core.schemas import FolderItem, QueueItemResponse


FOLDER_CONFIG = {
    "meeting-briefs": {"label": "Meeting Briefs", "icon": "calendarCheck"},
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


def list_queue_items(
    folder_type: str,
    user_id: str | None = None,
) -> list[QueueItemResponse]:
    """Get queue items for a specific folder."""
    with get_session() as session:
        stmt = select(CXQueueItem).where(
            CXQueueItem.folder_type == folder_type,
            CXQueueItem.status == "pending",
            CXQueueItem.is_active == True,
        )

        if user_id:
            stmt = stmt.where(CXQueueItem.assigned_to_user_id == user_id)

        if folder_type == "meeting-briefs":
            stmt = stmt.order_by(CXQueueItem.time_label.asc())
        else:
            stmt = stmt.order_by(CXQueueItem.created_time.desc())

        items = session.execute(stmt).scalars().all()

        return [
            QueueItemResponse(
                id=item.id,
                potential_id=item.potential_id,
                contact_id=item.contact_id,
                account_id=item.account_id,
                folder_type=item.folder_type,
                title=item.title,
                subtitle=item.subtitle,
                preview=item.preview,
                time_label=item.time_label,
                priority=item.priority,
                status=item.status,
                created_time=item.created_time,
            )
            for item in items
        ]


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
