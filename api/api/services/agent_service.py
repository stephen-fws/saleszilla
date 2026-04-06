"""Agent insight service — DB operations and agentflow API integration."""

import logging
from datetime import datetime, timezone

import requests
from sqlalchemy import select

import core.config as config
from core.database import get_session
from core.models import Account, Contact, CXAgentInsight, CXAgentTypeConfig, Potential, User
from core.schemas import AgentResultItem

logger = logging.getLogger(__name__)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _to_result_item(insight: CXAgentInsight, cfg: CXAgentTypeConfig) -> AgentResultItem:
    return AgentResultItem(
        id=insight.id,
        potential_id=insight.potential_id,
        agent_id=insight.agent_id or cfg.agent_id,
        agent_name=insight.agent_name or cfg.agent_name,
        tab_type=cfg.tab_type,
        content_type=insight.content_type or cfg.content_type,
        content=insight.content,
        status=insight.status,
        sort_order=cfg.sort_order,
        triggered_by=insight.triggered_by,
        triggered_at=insight.triggered_at,
        completed_at=insight.completed_time,
        error_message=insight.error_message,
    )


# ── Config queries ────────────────────────────────────────────────────────────

def list_active_configs() -> list[CXAgentTypeConfig]:
    with get_session() as session:
        stmt = (
            select(CXAgentTypeConfig)
            .where(CXAgentTypeConfig.is_active == True)
            .order_by(CXAgentTypeConfig.sort_order)
        )
        return list(session.execute(stmt).scalars().all())


def get_agent_config(agent_id: str) -> CXAgentTypeConfig | None:
    with get_session() as session:
        return session.get(CXAgentTypeConfig, agent_id)


# ── Result queries ────────────────────────────────────────────────────────────

def get_insights_for_tab(potential_id: str, tab_type: str) -> list[AgentResultItem]:
    with get_session() as session:
        stmt = (
            select(CXAgentInsight, CXAgentTypeConfig)
            .join(CXAgentTypeConfig, CXAgentInsight.agent_id == CXAgentTypeConfig.agent_id)
            .where(
                CXAgentInsight.potential_id == potential_id,
                CXAgentInsight.is_active == True,
                CXAgentTypeConfig.tab_type == tab_type,
            )
            .order_by(CXAgentTypeConfig.sort_order)
        )
        rows = session.execute(stmt).all()
        return [_to_result_item(i, c) for i, c in rows]


def get_all_insights(potential_id: str) -> list[AgentResultItem]:
    with get_session() as session:
        stmt = (
            select(CXAgentInsight, CXAgentTypeConfig)
            .join(CXAgentTypeConfig, CXAgentInsight.agent_id == CXAgentTypeConfig.agent_id)
            .where(
                CXAgentInsight.potential_id == potential_id,
                CXAgentInsight.is_active == True,
            )
            .order_by(CXAgentTypeConfig.sort_order)
        )
        rows = session.execute(stmt).all()
        return [_to_result_item(i, c) for i, c in rows]


# ── DB upsert ─────────────────────────────────────────────────────────────────

def _upsert_insight(
    potential_id: str,
    agent_id: str,
    agent_name: str,
    tab_type: str,
    content: str | None,
    content_type: str,
    status: str,
    execution_id: str | None = None,
    run_id: str | None = None,
    triggered_by: str | None = None,
    error_message: str | None = None,
) -> None:
    now = datetime.now(timezone.utc)
    with get_session() as session:
        stmt = select(CXAgentInsight).where(
            CXAgentInsight.potential_id == potential_id,
            CXAgentInsight.agent_id == agent_id,
        )
        existing = session.execute(stmt).scalar_one_or_none()
        if existing:
            existing.agent_name = agent_name
            existing.content = content
            existing.content_type = content_type
            existing.status = status
            existing.execution_id = execution_id
            existing.run_id = run_id
            existing.error_message = error_message
            existing.completed_time = now if status == "completed" else existing.completed_time
            existing.updated_time = now
            existing.is_active = True
            session.add(existing)
        else:
            session.add(CXAgentInsight(
                potential_id=potential_id,
                agent_type=tab_type,
                agent_id=agent_id,
                agent_name=agent_name,
                content=content,
                content_type=content_type,
                status=status,
                execution_id=execution_id,
                run_id=run_id,
                triggered_by=triggered_by,
                triggered_at=now,
                error_message=error_message,
                requested_time=now,
                completed_time=now if status == "completed" else None,
                created_time=now,
                updated_time=now,
                is_active=True,
            ))
        session.flush()


def _trigger_agentflow(potential_id: str, category: str, potential_data: dict) -> None:
    """POST to agentflow webhook to kick off agent execution. Fire-and-forget."""
    try:
        payload = {
            "entityId": potential_data.get("potential_number") or potential_id,
            "entityOwnerEmail": potential_data.get("owner_email", ""),
            "category": category,
            "source": "crm",
            "potentialId": potential_id,
            "customerName": potential_data.get("customer_name", ""),
            "contactEmail": potential_data.get("contact_email", ""),
            "contactPhone": potential_data.get("contact_phone", ""),
            "service": potential_data.get("service", ""),
            "subService": potential_data.get("sub_service", ""),
            "companyName": potential_data.get("company_name", ""),
            "customerCountry": potential_data.get("customer_country", ""),
            "companyWebsite": potential_data.get("company_website", ""),
            "customerRequirements": potential_data.get("description", ""),
        }
        requests.post(
            f"{config.AGENTFLOW_BASE_URL}/webhooks/crm",
            json=payload,
            timeout=10,
        )
    except Exception as e:
        logger.warning("Failed to trigger agentflow for %s category=%s: %s", potential_id, category, e)


def _load_potential_data(potential_id: str) -> dict:
    """Load potential + account + contact + owner data for trigger payload."""
    with get_session() as session:
        row = session.execute(
            select(Potential, Account, Contact, User)
            .outerjoin(Account, Potential.account_id == Account.account_id)
            .outerjoin(Contact, Potential.contact_id == Contact.contact_id)
            .outerjoin(User, Potential.potential_owner_id == User.user_id)
            .where(Potential.potential_id == potential_id)
        ).first()
        if not row:
            return {}
        p, a, c, u = row
        return {
            "owner_email": u.email if u else "",
            "customer_name": c.full_name if c else "",
            "contact_email": c.email if c else "",
            "contact_phone": c.phone if c else "",
            "service": p.service or "",
            "sub_service": p.sub_service or "",
            "company_name": a.account_name if a else "",
            "customer_country": (a.billing_country or a.country_fws) if a else "",
            "company_website": a.website if a else "",
            "description": p.description or "",
            "potential_number": p.potential_number or "",
        }


# ── Public API ────────────────────────────────────────────────────────────────

def process_webhook(payload_data: dict) -> None:
    """
    Process incoming agentflow webhook notification.
    Content is delivered inline in the payload — no secondary fetch needed.
    """
    agent_id = payload_data.get("agent_id", "")
    agent_name = payload_data.get("agent_name", "")
    external_id = payload_data.get("external_id", "")  # = potential_id
    execution_id = payload_data.get("execution_id")
    run_id = payload_data.get("run_id")
    status = payload_data.get("status", "")
    content = payload_data.get("content")
    content_type_override = payload_data.get("content_type")

    cfg = get_agent_config(agent_id)
    if not cfg:
        logger.info("Ignoring webhook for unknown agent_id=%s", agent_id)
        return

    if status == "completed":
        final_status = "completed"
        error_message = None
    else:
        final_status = "error"
        content = None
        error_message = f"Agent execution status: {status}"

    _upsert_insight(
        potential_id=external_id,
        agent_id=agent_id,
        agent_name=agent_name,
        tab_type=cfg.tab_type,
        content=content,
        content_type=content_type_override or cfg.content_type,
        status=final_status,
        execution_id=execution_id,
        run_id=run_id,
        error_message=error_message,
    )


def init_agents_for_potential(potential_id: str, triggered_by: str = "new_potential") -> None:
    """
    Upsert all active agent rows to 'pending' and fire the agentflow trigger.
    Works for both new potentials and re-runs on old ones — existing rows are
    reset to pending so the UI shows loading state while agents execute.
    """
    configs = list_active_configs()
    if not configs:
        return

    now = datetime.now(timezone.utc)
    with get_session() as session:
        for cfg in configs:
            existing = session.execute(
                select(CXAgentInsight).where(
                    CXAgentInsight.potential_id == potential_id,
                    CXAgentInsight.agent_id == cfg.agent_id,
                )
            ).scalar_one_or_none()
            if existing:
                # Reset existing row so UI shows spinner and old content is cleared
                existing.status = "pending"
                existing.content = None
                existing.error_message = None
                existing.triggered_by = triggered_by
                existing.triggered_at = now
                existing.completed_time = None
                existing.updated_time = now
                existing.is_active = True
                session.add(existing)
            else:
                session.add(CXAgentInsight(
                    potential_id=potential_id,
                    agent_type=cfg.tab_type,
                    agent_id=cfg.agent_id,
                    agent_name=cfg.agent_name,
                    content=None,
                    content_type=cfg.content_type,
                    status="pending",
                    triggered_by=triggered_by,
                    triggered_at=now,
                    requested_time=now,
                    created_time=now,
                    updated_time=now,
                    is_active=True,
                ))
        session.commit()

    # Fire one POST to the gateway agent — it orchestrates all downstream agents
    potential_data = _load_potential_data(potential_id)
    _trigger_agentflow(potential_id, config.AGENTFLOW_TRIGGER_CATEGORY, potential_data)


def trigger_single_agent(potential_id: str, agent_id: str, triggered_by: str = "user") -> AgentResultItem | None:
    """Trigger a single agent manually and mark it as pending."""
    cfg = get_agent_config(agent_id)
    if not cfg:
        return None

    now = datetime.now(timezone.utc)
    _upsert_insight(
        potential_id=potential_id,
        agent_id=agent_id,
        agent_name=cfg.agent_name,
        tab_type=cfg.tab_type,
        content=None,
        content_type=cfg.content_type,
        status="pending",
        triggered_by=triggered_by,
    )

    potential_data = _load_potential_data(potential_id)
    _trigger_agentflow(potential_id, config.AGENTFLOW_TRIGGER_CATEGORY, potential_data)

    # Return the pending row
    results = get_insights_for_tab(potential_id, cfg.tab_type)
    return next((r for r in results if r.agent_id == agent_id), None)


# Legacy alias kept for old route code
def list_agent_insights(potential_id: str):
    return get_all_insights(potential_id)


def upsert_agent_insight(potential_id: str, agent_type: str, status: str = "ready", content: str | None = None):
    """Legacy stub — kept for backward compat. New code uses process_webhook."""
    pass
