"""Activity timeline queries."""

from sqlalchemy import select

from core.database import get_session
from core.models import CXActivity
from core.schemas import ActivityItem


def list_activities(potential_id: str, limit: int = 50) -> list[ActivityItem]:
    with get_session() as session:
        stmt = select(CXActivity).where(
            CXActivity.potential_id == potential_id,
            CXActivity.is_active == True,
        ).order_by(CXActivity.created_time.desc()).limit(limit)
        return [
            ActivityItem(
                id=a.id, potential_id=a.potential_id, activity_type=a.activity_type,
                description=a.description, performed_by_user_id=a.performed_by_user_id,
                created_time=a.created_time,
            )
            for a in session.execute(stmt).scalars().all()
        ]
