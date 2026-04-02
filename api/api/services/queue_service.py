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


def complete_queue_item(item_id: int) -> bool:
    """Mark a queue item as completed."""
    now = datetime.now(timezone.utc)
    with get_session() as session:
        item = session.get(CXQueueItem, item_id)
        if not item:
            return False
        item.status = "completed"
        item.updated_time = now
        session.add(item)
    return True
