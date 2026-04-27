"""Activity timeline queries and logging."""

from datetime import datetime, timezone

from sqlalchemy import or_, select

from core.database import get_session
from core.models import CXActivity, Potential, User
from core.schemas import ActivityItem


# Friendly labels for AI workflow categories — kept here so the timeline copy
# is consistent across every trigger site. Add a key when a new category lands.
_AGENT_CATEGORY_LABELS: dict[str, str] = {
    "newEnquiry":       "First Response Email draft",
    "followUp":         "Follow-up draft",
    "followUpInactive": "Inactive follow-up draft",
    "reply":            "Reply draft",
    "meeting_brief":    "Meeting brief",
    "news":             "News check",
    "stage_update":     "Stage update",
    "todo_reconcile":   "Todo reconcile",
}

# Tab types whose completions are user-visible enough to warrant a timeline
# entry. Internal-only producers (attachment, news_check, todo_reconcile)
# would create noise without giving the user new information.
_USER_VISIBLE_COMPLETION_TABS: frozenset[str] = frozenset({
    "next_action",
    "research",
    "solution_brief",
})


def _resolve_potential_uuid(session, potential_id_or_number: str) -> str | None:
    """Accept either UUID or 7-digit potential_number; return the UUID."""
    return session.execute(
        select(Potential.potential_id).where(or_(
            Potential.potential_id == potential_id_or_number,
            Potential.potential_number == potential_id_or_number,
        ))
    ).scalar_one_or_none()


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


def log_agent_trigger(
    potential_id_or_number: str,
    category: str,
    description: str | None = None,
) -> None:
    """Log an AI workflow / graph trigger to the timeline.

    `potential_id_or_number` accepts either UUID or 7-digit potential_number;
    we resolve to UUID since timeline activities are keyed there.
    """
    try:
        with get_session() as session:
            uuid = _resolve_potential_uuid(session, potential_id_or_number)
        if not uuid:
            return
        label = description or _AGENT_CATEGORY_LABELS.get(category) or category
        log_activity(
            potential_id=uuid,
            activity_type="agent_triggered",
            description=f"AI workflow triggered: {label}",
        )
    except Exception:
        pass


def log_agent_completed(
    potential_id_or_number: str,
    agent_name: str | None,
    tab_type: str | None,
    status: str,
) -> None:
    """Log an agent completion (success or error) to the timeline.

    Only fires for user-visible tab types — internal-only agents (attachment
    PDF producer, news_check gate, todo reconciler) would just create noise.
    """
    if tab_type not in _USER_VISIBLE_COMPLETION_TABS:
        return
    try:
        with get_session() as session:
            uuid = _resolve_potential_uuid(session, potential_id_or_number)
        if not uuid:
            return
        verb = "completed" if status == "completed" else "failed"
        name = agent_name or tab_type or "AI agent"
        log_activity(
            potential_id=uuid,
            activity_type="agent_completed",
            description=f"AI agent {verb}: {name}",
        )
    except Exception:
        pass
