"""Agent insight operations — CRUD and webhook handling."""

from datetime import datetime, timezone

from sqlalchemy import select

from core.database import get_session
from core.models import CXAgentInsight
from core.schemas import AgentInsightItem


def list_agent_insights(potential_id: str) -> list[AgentInsightItem]:
    with get_session() as session:
        stmt = select(CXAgentInsight).where(
            CXAgentInsight.potential_id == potential_id,
            CXAgentInsight.is_active == True,
        ).order_by(CXAgentInsight.agent_type)
        return [
            AgentInsightItem(
                id=a.id, potential_id=a.potential_id, agent_type=a.agent_type,
                content=a.content, status=a.status,
                requested_time=a.requested_time, completed_time=a.completed_time,
            )
            for a in session.execute(stmt).scalars().all()
        ]


def upsert_agent_insight(
    potential_id: str,
    agent_type: str,
    content: str | None = None,
    status: str = "ready",
) -> AgentInsightItem:
    """Upsert agent insight (keyed by potential_id + agent_type)."""
    now = datetime.now(timezone.utc)
    with get_session() as session:
        stmt = select(CXAgentInsight).where(
            CXAgentInsight.potential_id == potential_id,
            CXAgentInsight.agent_type == agent_type,
        )
        existing = session.execute(stmt).scalar_one_or_none()

        if existing:
            existing.content = content
            existing.status = status
            existing.completed_time = now if status == "ready" else None
            existing.updated_time = now
            existing.is_active = True
            session.add(existing)
            session.flush()
            session.refresh(existing)
            row = existing
        else:
            row = CXAgentInsight(
                potential_id=potential_id, agent_type=agent_type,
                content=content, status=status,
                requested_time=now, completed_time=now if status == "ready" else None,
                created_time=now, updated_time=now, is_active=True,
            )
            session.add(row)
            session.flush()
            session.refresh(row)

        return AgentInsightItem(
            id=row.id, potential_id=row.potential_id, agent_type=row.agent_type,
            content=row.content, status=row.status,
            requested_time=row.requested_time, completed_time=row.completed_time,
        )


def mark_agent_pending(potential_id: str, agent_type: str) -> AgentInsightItem:
    """Create or update an insight to pending status (agent requested)."""
    return upsert_agent_insight(potential_id, agent_type, content=None, status="pending")
