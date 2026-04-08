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
    ms_event_id: str | None = None,
) -> None:
    now = datetime.now(timezone.utc)
    with get_session() as session:
        stmt = select(CXAgentInsight).where(
            CXAgentInsight.potential_id == potential_id,
            CXAgentInsight.agent_id == agent_id,
        )
        if ms_event_id is not None:
            stmt = stmt.where(CXAgentInsight.ms_event_id == ms_event_id)
        else:
            stmt = stmt.where(CXAgentInsight.ms_event_id.is_(None))
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
                ms_event_id=ms_event_id,
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


def _trigger_agentflow(
    potential_id: str,
    potential_data: dict,
    category: str | None = None,
    extra_data: dict | None = None,
) -> None:
    """POST to agentflow webhook to kick off agent execution. Fire-and-forget.

    If `category` is provided (e.g. "meeting-prep"), it's added to the payload's
    data block as an orchestration hint for agentflow.
    `extra_data` is merged into the payload's data block.
    """
    url = f"{config.AGENTFLOW_BASE_URL}/webhooks/crm"
    potential_number = potential_data.get("potential_number") or potential_id
    data_block = {
        "potential_id": potential_number,
        "company_name": potential_data.get("company_name", ""),
        "company_website": potential_data.get("company_website", ""),
        "contact_email": potential_data.get("contact_email", ""),
        "contact_phone": potential_data.get("contact_phone", ""),
        "customer_name": potential_data.get("customer_name", ""),
        "service": potential_data.get("service", ""),
        "sub_service": potential_data.get("sub_service", ""),
        "lead_source": potential_data.get("lead_source", ""),
        "customer_requirements": potential_data.get("description", ""),
    }
    if category:
        data_block["category"] = category
    if extra_data:
        data_block.update(extra_data)

    payload = {
        "event_source": "crm",
        "action": "create",
        "entity_type": "sales_lead",
        "entity_id": potential_number,
        "data": data_block,
    }
    logger.info("Triggering agentflow: POST %s | payload=%s", url, payload)
    try:
        resp = requests.post(url, json=payload, headers={"x-api-key": config.AGENTFLOW_API_KEY}, timeout=10)
        logger.info("Agentflow response: status=%s body=%s", resp.status_code, resp.text)
    except Exception as e:
        logger.error("Failed to trigger agentflow for %s: %s", potential_id, e)


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
            "lead_source": p.lead_source or "",
            "potential_number": p.potential_number or "",
        }


# ── Public API ────────────────────────────────────────────────────────────────

def process_webhook(payload_data: dict) -> None:
    """
    Process incoming agentflow webhook notification.
    Content is delivered inline in the payload — no secondary fetch needed.

    For meeting briefs, the payload includes `ms_event_id` so the result lands
    in the correct per-meeting row (instead of a generic per-potential row).
    """
    agent_id = payload_data.get("agent_id", "")
    agent_name = payload_data.get("agent_name", "")
    external_id = payload_data.get("external_id", "")  # = potential_id
    execution_id = payload_data.get("execution_id")
    run_id = payload_data.get("run_id")
    status = payload_data.get("status", "")
    content = payload_data.get("content")
    content_type_override = payload_data.get("content_type")
    ms_event_id = payload_data.get("ms_event_id")  # only set for meeting_brief results

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
        ms_event_id=ms_event_id,
    )


def init_agents_for_potential(potential_id: str, triggered_by: str = "new_potential") -> None:
    """
    Upsert all active agent rows to 'pending' and fire the agentflow trigger.
    Works for both new potentials and re-runs on old ones — existing rows are
    reset to pending so the UI shows loading state while agents execute.
    """
    logger.info("init_agents_for_potential called: potential_id=%s triggered_by=%s", potential_id, triggered_by)
    # Always fire the agentflow trigger — independent of whether config rows exist
    potential_data = _load_potential_data(potential_id)
    logger.info("Loaded potential data: %s", potential_data)
    _trigger_agentflow(potential_id, potential_data)

    # If agent configs exist, upsert pending insight rows so the UI shows spinners
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
    _trigger_agentflow(potential_id, potential_data)

    # Return the pending row
    results = get_insights_for_tab(potential_id, cfg.tab_type)
    return next((r for r in results if r.agent_id == agent_id), None)


# ── Meeting brief trigger ────────────────────────────────────────────────────

MEETING_BRIEF_AGENT_TYPE = "meeting_brief"
MEETING_BRIEF_AGENT_ID = "meeting_brief"  # convention: agentflow side keys on this


def get_meeting_brief_insight(potential_id: str, ms_event_id: str) -> CXAgentInsight | None:
    """Look up an existing meeting_brief insight row for this potential+meeting."""
    with get_session() as session:
        return session.execute(
            select(CXAgentInsight).where(
                CXAgentInsight.potential_id == potential_id,
                CXAgentInsight.ms_event_id == ms_event_id,
                CXAgentInsight.agent_type == MEETING_BRIEF_AGENT_TYPE,
                CXAgentInsight.is_active == True,
            )
        ).scalar_one_or_none()


def is_meeting_brief_stale(insight: CXAgentInsight, max_age_hours: int = 4) -> bool:
    """Stale if older than TTL OR if linked Potential has been modified since."""
    if not insight.completed_time and insight.status != "completed":
        return False  # Pending/running — not stale, just in flight
    now = datetime.now(timezone.utc)
    completed = insight.completed_time or insight.created_time
    if completed and (now - completed).total_seconds() > max_age_hours * 3600:
        return True
    # Activity-aware: check if the Potential has been modified since
    with get_session() as session:
        modified_time = session.execute(
            select(Potential.modified_time).where(Potential.potential_id == insight.potential_id)
        ).scalar_one_or_none()
    if modified_time and completed and modified_time > completed:
        return True
    return False


def fire_meeting_brief(
    potential_id: str,
    ms_event_id: str,
    meeting_info: dict,
    triggered_by: str = "meeting_brief_lazy",
) -> CXAgentInsight:
    """Create-or-update the meeting_brief insight row to 'pending' and fire
    the agentflow trigger. Sends category='meeting-prep' if base research is
    incomplete (full chain), or 'meeting-brief-only' if base research is cached.

    `meeting_info` is sent as-is under the data.meeting_info key in the agentflow
    payload. Expected keys: ms_event_id, title, start, end, is_online, location,
    organizer, attendees, agenda.
    """
    now = datetime.now(timezone.utc)

    # 5-minute hard floor — don't re-fire too aggressively
    existing = get_meeting_brief_insight(potential_id, ms_event_id)
    if existing and existing.triggered_at:
        seconds_since_trigger = (now - existing.triggered_at).total_seconds()
        if seconds_since_trigger < 300 and existing.status in ("pending", "running"):
            logger.info(
                "Skipping meeting_brief trigger for %s/%s — last fired %ds ago, still %s",
                potential_id, ms_event_id, int(seconds_since_trigger), existing.status,
            )
            return existing

    # Upsert the row to pending
    with get_session() as session:
        row = session.execute(
            select(CXAgentInsight).where(
                CXAgentInsight.potential_id == potential_id,
                CXAgentInsight.ms_event_id == ms_event_id,
                CXAgentInsight.agent_type == MEETING_BRIEF_AGENT_TYPE,
            )
        ).scalar_one_or_none()
        if row:
            row.status = "pending"
            row.content = None
            row.error_message = None
            row.triggered_by = triggered_by
            row.triggered_at = now
            row.completed_time = None
            row.updated_time = now
            row.is_active = True
        else:
            row = CXAgentInsight(
                potential_id=potential_id,
                agent_type=MEETING_BRIEF_AGENT_TYPE,
                ms_event_id=ms_event_id,
                agent_id=MEETING_BRIEF_AGENT_ID,
                agent_name="Meeting Brief",
                content=None,
                content_type="markdown",
                status="pending",
                triggered_by=triggered_by,
                triggered_at=now,
                requested_time=now,
                created_time=now,
                updated_time=now,
                is_active=True,
            )
            session.add(row)
        session.flush()
        session.refresh(row)
        insight_to_return = row

    # Decide category based on base research completion:
    #   - Base research complete → "meeting-brief-only" (agentflow runs just the brief agent)
    #   - Base research missing  → "meeting-prep" (agentflow runs the full chain)
    base_complete = has_all_base_research_completed(potential_id)
    category = "meeting-brief-only" if base_complete else "meeting-prep"

    potential_data = _load_potential_data(potential_id)
    extra_data = {
        "meeting_info": meeting_info,
    }
    logger.info(
        "fire_meeting_brief: potential=%s ms_event_id=%s category=%s base_research_complete=%s",
        potential_id, ms_event_id, category, base_complete,
    )
    _trigger_agentflow(potential_id, potential_data, category=category, extra_data=extra_data)

    return insight_to_return


def has_all_base_research_completed(potential_id: str) -> bool:
    """True if every active agent in CX_AgentTypeConfig with tab_type='research'
    has a completed insight for this potential. Used by the meeting brief flow
    to decide whether to fire the chained 'meeting-prep' category trigger or
    just the standalone meeting_brief agent.
    """
    with get_session() as session:
        # Active research-type agents
        base_agent_ids = set(session.execute(
            select(CXAgentTypeConfig.agent_id).where(
                CXAgentTypeConfig.is_active == True,
                CXAgentTypeConfig.tab_type == "research",
            )
        ).scalars().all())
        if not base_agent_ids:
            # No base research agents configured at all → nothing to wait for
            return True

        completed_agent_ids = set(session.execute(
            select(CXAgentInsight.agent_id).where(
                CXAgentInsight.potential_id == potential_id,
                CXAgentInsight.is_active == True,
                CXAgentInsight.status == "completed",
                CXAgentInsight.ms_event_id.is_(None),  # exclude meeting brief rows
                CXAgentInsight.agent_id.in_(base_agent_ids),
            )
        ).scalars().all())

    return base_agent_ids.issubset(completed_agent_ids)


# Legacy alias kept for old route code
def list_agent_insights(potential_id: str):
    return get_all_insights(potential_id)


def upsert_agent_insight(potential_id: str, agent_type: str, status: str = "ready", content: str | None = None):
    """Legacy stub — kept for backward compat. New code uses process_webhook."""
    pass
