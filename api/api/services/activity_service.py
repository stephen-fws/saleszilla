"""Activity timeline queries and logging."""

from datetime import datetime, timezone

from sqlalchemy import select

from core.database import get_session
from core.models import CXActivity, User
from core.schemas import ActivityItem


def list_activities(potential_id: str, limit: int = 100) -> list[ActivityItem]:
    with get_session() as session:
        stmt = (
            select(CXActivity, User)
            .outerjoin(User, CXActivity.performed_by_user_id == User.user_id)
            .where(
                CXActivity.potential_id == potential_id,
                CXActivity.is_active == True,
            )
            .order_by(CXActivity.created_time.desc())
            .limit(limit)
        )
        return [
            ActivityItem(
                id=a.id,
                potential_id=a.potential_id,
                activity_type=a.activity_type,
                description=a.description,
                performed_by_user_id=a.performed_by_user_id,
                performed_by_name=u.name if u else None,
                created_time=a.created_time,
            )
            for a, u in session.execute(stmt).all()
        ]


def log_activity(
    potential_id: str,
    activity_type: str,
    description: str | None = None,
    user_id: str | None = None,
    account_id: str | None = None,
    contact_id: str | None = None,
) -> None:
    """Write a single audit entry. Fire-and-forget — never raises."""
    try:
        now = datetime.now(timezone.utc)
        with get_session() as session:
            session.add(CXActivity(
                potential_id=potential_id,
                activity_type=activity_type,
                description=description,
                performed_by_user_id=user_id,
                account_id=account_id,
                contact_id=contact_id,
                created_time=now,
                updated_time=now,
                is_active=True,
            ))
    except Exception:
        pass  # Never let audit logging break the main operation
