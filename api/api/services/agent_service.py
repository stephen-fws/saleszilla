"""Agent insight service — DB operations and agentflow API integration."""

import logging
from datetime import datetime, timezone

import requests
from sqlalchemy import or_, select

import core.config as config
from core.database import get_session
from core.models import Account, Contact, CXAgentInsight, CXAgentTypeConfig, LookupPotentialStage, Potential, User
from core.schemas import AgentResultItem

logger = logging.getLogger(__name__)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _to_result_item(insight: CXAgentInsight, cfg: CXAgentTypeConfig) -> AgentResultItem:
    return AgentResultItem(
        id=insight.id,
        potential_id=insight.potential_id,
        agent_id=insight.agent_id or cfg.agent_id,
        agent_name=cfg.agent_name,
        tab_type=cfg.tab_type,
        content_type=insight.content_type or cfg.content_type,
        content=insight.content,
        status=insight.status,
        sort_order=cfg.sort_order,
        trigger_category=cfg.trigger_category,
        triggered_by=insight.triggered_by,
        triggered_at=insight.triggered_at,
        completed_at=insight.completed_time,
        error_message=insight.error_message,
    )


# ── ID resolver ───────────────────────────────────────────────────────────────

def _apply_stage_update(session, potential_number: str, content: str, now) -> None:
    """Parse the stage_update agent's JSON output and auto-update the Potential."""
    import json as _json
    try:
        data = _json.loads(content)
    except (ValueError, TypeError):
        logger.warning("stage_update: invalid JSON for potential=%s: %s", potential_number, content[:100])
        return

    new_stage = data.get("stage")
    new_probability = data.get("probability")

    if not new_stage:
        logger.warning("stage_update: no stage in response for potential=%s", potential_number)
        return

    # Validate stage against supported stages
    valid_stages = set(session.execute(
        select(LookupPotentialStage.stage_name)
    ).scalars().all())
    if new_stage not in valid_stages:
        logger.warning("stage_update: invalid stage '%s' for potential=%s (valid: %s)",
                         new_stage, potential_number, valid_stages)
        return

    # Find the potential by potential_number
    potential = session.execute(
        select(Potential).where(Potential.potential_number == potential_number)
    ).scalar_one_or_none()
    if not potential:
        logger.warning("stage_update: potential not found for number=%s", potential_number)
        return

    old_stage = potential.stage
    old_probability = potential.probability

    # Update stage
    changed = False
    if new_stage != old_stage:
        potential.stage = new_stage
        changed = True
    if new_probability is not None and isinstance(new_probability, (int, float)):
        new_prob = max(0, min(100, int(new_probability)))
        if new_prob != old_probability:
            potential.probability = new_prob
            changed = True

    if changed:
        potential.modified_time = now.replace(tzinfo=None) if now.tzinfo else now
        session.add(potential)

        # Log activity
        from core.models import CXActivity
        changes = []
        if new_stage != old_stage:
            changes.append(f"Stage: {old_stage} → {new_stage}")
        if new_probability is not None and int(new_probability) != (old_probability or 0):
            changes.append(f"Probability: {old_probability}% → {int(new_probability)}%")
        ai_highlight = data.get("ai_highlight", "")
        desc = f"AI stage update: {'; '.join(changes)}"
        if ai_highlight:
            desc += f" — {ai_highlight}"
        session.add(CXActivity(
            potential_id=potential.potential_id,
            contact_id=potential.contact_id,
            account_id=potential.account_id,
            activity_type="stage_changed",
            description=desc,
            performed_by_user_id=None,
            created_time=now.replace(tzinfo=None) if now.tzinfo else now,
            updated_time=now.replace(tzinfo=None) if now.tzinfo else now,
            is_active=True,
        ))
        logger.info("stage_update: potential=%s %s", potential_number, "; ".join(changes))
    else:
        logger.info("stage_update: no change for potential=%s (stage=%s, prob=%s)",
                     potential_number, new_stage, new_probability)


def _resolve_potential_number(identifier: str) -> str:
    """
    CX_AgentInsights keys on the 7-digit potential_number (business key), not
    the UUID primary key. Routes receive the UUID from the UI, so resolve it
    before reading/writing insights. Returns the identifier unchanged if it
    already looks like a potential_number.
    """
    if not identifier:
        return identifier
    # Potential_number is a zero-padded 7-digit string
    if identifier.isdigit() and len(identifier) <= 10:
        return identifier
    with get_session() as session:
        row = session.execute(
            select(Potential.potential_number).where(Potential.potential_id == identifier)
        ).first()
        if row and row[0]:
            return row[0]
        logger.warning("_resolve_potential_number: no potential_number for id=%s, using raw", identifier)
        return identifier


# ── Config queries ────────────────────────────────────────────────────────────

def list_active_configs(trigger_category: str | None = None) -> list[CXAgentTypeConfig]:
    with get_session() as session:
        stmt = (
            select(CXAgentTypeConfig)
            .where(CXAgentTypeConfig.is_active == True)
            .order_by(CXAgentTypeConfig.sort_order)
        )
        if trigger_category:
            stmt = stmt.where(CXAgentTypeConfig.trigger_category == trigger_category)
        return list(session.execute(stmt).scalars().all())


def get_agent_config(agent_id: str) -> CXAgentTypeConfig | None:
    with get_session() as session:
        return session.get(CXAgentTypeConfig, agent_id)


# ── Result queries ────────────────────────────────────────────────────────────

def get_insights_for_tab(potential_id: str, tab_type: str) -> list[AgentResultItem]:
    potential_id = _resolve_potential_number(potential_id)
    with get_session() as session:
        stmt = (
            select(CXAgentInsight, CXAgentTypeConfig)
            .join(CXAgentTypeConfig, CXAgentInsight.agent_id == CXAgentTypeConfig.agent_id)
            .where(
                CXAgentInsight.potential_id == potential_id,
                CXAgentInsight.is_active == True,
                CXAgentInsight.status != "actioned",
                CXAgentTypeConfig.tab_type == tab_type,
            )
            .order_by(CXAgentTypeConfig.sort_order)
        )
        rows = session.execute(stmt).all()
        return [_to_result_item(i, c) for i, c in rows]


def get_all_insights(potential_id: str) -> list[AgentResultItem]:
    potential_id = _resolve_potential_number(potential_id)
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
    graph_id: str,
    extra_attrs: dict | None = None,
) -> None:
    """POST to agentflow /external/execute to kick off a graph. Fire-and-forget."""
    if not graph_id:
        logger.warning("Skipping agentflow trigger: no graph_id provided (potential=%s)", potential_id)
        return

    url = f"{config.AGENTFLOW_BASE_URL}/external/execute"
    potential_number = potential_data.get("potential_number") or potential_id
    attributes = {
        "customer_name": potential_data.get("customer_name", ""),
        "contact_email": potential_data.get("contact_email", ""),
        "contact_phone": potential_data.get("contact_phone", ""),
        "company_name": potential_data.get("company_name", ""),
        "company_website": potential_data.get("company_website", ""),
        "customer_country": potential_data.get("customer_country", ""),
        "service": potential_data.get("service", ""),
        "sub_service": potential_data.get("sub_service", ""),
        "customer_requirements": potential_data.get("description", ""),
        "lead_source": potential_data.get("lead_source", ""),
        "potential_id": potential_number,
        "entity_owner_email": potential_data.get("owner_email", ""),
    }
    if extra_attrs:
        attributes.update(extra_attrs)

    payload = {
        "graph_id": graph_id,
        "entity": {
            "entity_type": "sales_lead",
            "external_id": potential_number,
            "attributes": attributes,
        },
        "callback_connection": config.AGENTFLOW_CALLBACK_CONNECTION,
        "callback_mode": "per_agent",
    }
    logger.info("Triggering agentflow: POST %s | payload=%s", url, payload)
    try:
        resp = requests.post(url, json=payload, headers={"X-Api-Key": config.AGENTFLOW_API_KEY}, timeout=10)
        logger.info("Agentflow response: status=%s body=%s", resp.status_code, resp.text)
    except Exception as e:
        logger.error("Failed to trigger agentflow for %s: %s", potential_id, e)


def _load_potential_data(potential_id: str) -> dict:
    """Load potential + account + contact + owner data for trigger payload.

    Accepts either the UUID (Potentials.potential_id) or the 7-digit
    potential_number — the external init endpoint can receive either form.
    """
    with get_session() as session:
        row = session.execute(
            select(Potential, Account, Contact, User)
            .outerjoin(Account, Potential.account_id == Account.account_id)
            .outerjoin(Contact, Potential.contact_id == Contact.contact_id)
            .outerjoin(User, Potential.potential_owner_id == User.user_id)
            .where(or_(
                Potential.potential_id == potential_id,
                Potential.potential_number == potential_id,
            ))
        ).first()
        if not row:
            logger.warning("_load_potential_data: no Potential found for identifier=%s (tried UUID and potential_number)", potential_id)
            return {}
        p, a, c, u = row
        if not a:
            logger.warning("_load_potential_data: Potential %s has no linked Account (account_id=%s)", potential_id, p.account_id)
        if not c:
            logger.warning("_load_potential_data: Potential %s has no linked Contact (contact_id=%s)", potential_id, p.contact_id)
        if not u:
            logger.warning("_load_potential_data: Potential %s has no linked User owner (potential_owner_id=%s)", potential_id, p.potential_owner_id)
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
    Process incoming agentflow per-agent callback.

    Event types:
      - agent.completed  → status=completed, content from output.answer
      - agent.skipped    → status=completed (cached re-use of prior output)
      - agent.failed     → status=error, error message from `error`
    """
    event = payload_data.get("event", "")
    agent_id = payload_data.get("agent_id", "")
    agent_name = payload_data.get("agent_name") or ""
    external_id = payload_data.get("external_entity_id", "")  # potential_number
    graph_execution_id = payload_data.get("graph_execution_id")
    agent_execution_id = payload_data.get("agent_execution_id")
    output = payload_data.get("output") or {}
    error = payload_data.get("error")

    cfg = get_agent_config(agent_id)
    if not cfg:
        logger.info("Ignoring webhook for unknown agent_id=%s", agent_id)
        return

    if event in ("agent.completed", "agent.skipped"):
        final_status = "completed"
        content = output.get("answer") if isinstance(output, dict) else None
        error_message = None
    else:  # agent.failed or anything else
        final_status = "error"
        content = None
        error_message = error or f"Agent event: {event}"

    # Update-only: pending row must already exist (created by init_agents_for_potential).
    # If missing, log and drop — callback is an anomaly (stale execution, wrong id, etc).
    now = datetime.now(timezone.utc)
    with get_session() as session:
        # Find the most recent pending/running row for this agent.
        # Use .first() instead of .scalar_one_or_none() because meeting brief
        # agents can have multiple rows (one per ms_event_id).
        existing = session.execute(
            select(CXAgentInsight).where(
                CXAgentInsight.potential_id == external_id,
                CXAgentInsight.agent_id == agent_id,
            ).order_by(CXAgentInsight.triggered_at.desc()).limit(1)
        ).scalar_one_or_none()
        if not existing:
            logger.warning(
                "Webhook drop: no pending row for potential=%s agent_id=%s event=%s",
                external_id, agent_id, event,
            )
            return
        existing.agent_name = agent_name or existing.agent_name
        existing.content = content
        existing.content_type = cfg.content_type
        existing.status = final_status
        existing.execution_id = graph_execution_id
        existing.run_id = agent_execution_id
        existing.error_message = error_message
        existing.completed_time = now if final_status == "completed" else existing.completed_time
        existing.updated_time = now
        existing.is_active = True
        session.add(existing)

        # stage_update agent: auto-apply stage + probability to Potential
        if cfg.trigger_category == "stage_update" and final_status == "completed" and content:
            _apply_stage_update(session, external_id, content, now)

    # Attachment agent: upload the HTML to GCS + register as a draft attachment.
    # Runs OUTSIDE the insight-save session because it has its own transactional write.
    # Empty/whitespace content is treated as "no attachment" (save_from_agent handles it).
    if cfg.tab_type == "attachment" and final_status == "completed":
        try:
            from api.services.draft_attachment_service import save_from_agent
            save_from_agent(external_id, agent_id, content or "")
        except Exception:
            logger.exception("attachment agent: failed to persist attachment for %s/%s", external_id, agent_id)


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
    _trigger_agentflow(potential_id, potential_data, graph_id=config.AGENTFLOW_GRAPH_NEW_POTENTIAL)

    # DB insights are keyed on potential_number (7-digit business key), not UUID
    pn = potential_data.get("potential_number") or _resolve_potential_number(potential_id)

    # Only create insight rows for newEnquiry agents (not followUp, meetingBrief, etc.)
    configs = list_active_configs(trigger_category="newEnquiry")
    if not configs:
        return

    now = datetime.now(timezone.utc)
    with get_session() as session:
        for cfg in configs:
            existing = session.execute(
                select(CXAgentInsight).where(
                    CXAgentInsight.potential_id == pn,
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
                    potential_id=pn,
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

    potential_data = _load_potential_data(potential_id)
    pn = potential_data.get("potential_number") or _resolve_potential_number(potential_id)

    _upsert_insight(
        potential_id=pn,
        agent_id=agent_id,
        agent_name=cfg.agent_name,
        tab_type=cfg.tab_type,
        content=None,
        content_type=cfg.content_type,
        status="pending",
        triggered_by=triggered_by,
    )

    _trigger_agentflow(potential_id, potential_data, graph_id=config.AGENTFLOW_GRAPH_NEW_POTENTIAL)

    # Return the pending row
    results = get_insights_for_tab(pn, cfg.tab_type)
    return next((r for r in results if r.agent_id == agent_id), None)


# ── Meeting brief trigger ────────────────────────────────────────────────────

MEETING_BRIEF_AGENT_TYPE = "meeting_brief"
MEETING_BRIEF_AGENT_ID = "meeting_brief"  # convention: agentflow side keys on this


def get_meeting_brief_insight(potential_id: str, ms_event_id: str) -> CXAgentInsight | None:
    """Look up an existing meeting_brief insight row for this potential+meeting.
    Uses TriggerCategory='meeting_brief' from config to find the right agent_ids."""
    with get_session() as session:
        mb_agent_ids = set(session.execute(
            select(CXAgentTypeConfig.agent_id).where(
                CXAgentTypeConfig.is_active == True,
                CXAgentTypeConfig.trigger_category == "meeting_brief",
            )
        ).scalars().all())
        if not mb_agent_ids:
            return None
        return session.execute(
            select(CXAgentInsight).where(
                CXAgentInsight.potential_id == potential_id,
                CXAgentInsight.ms_event_id == ms_event_id,
                CXAgentInsight.agent_id.in_(mb_agent_ids),
                CXAgentInsight.is_active == True,
            )
        ).scalar_one_or_none()


def is_meeting_brief_stale(insight: CXAgentInsight, max_age_hours: int = 4) -> bool:
    """Stale if older than TTL OR if linked Potential has been modified since."""
    if not insight.completed_time and insight.status != "completed":
        return False  # Pending/running — not stale, just in flight
    now = datetime.now(timezone.utc)
    completed = insight.completed_time or insight.created_time
    if completed:
        c = completed.replace(tzinfo=timezone.utc) if completed.tzinfo is None else completed
        if (now - c).total_seconds() > max_age_hours * 3600:
            return True
    # Activity-aware: check if the Potential has been modified since
    with get_session() as session:
        modified_time = session.execute(
            select(Potential.modified_time).where(Potential.potential_id == insight.potential_id)
        ).scalar_one_or_none()
    if modified_time and completed:
        m = modified_time.replace(tzinfo=timezone.utc) if modified_time.tzinfo is None else modified_time
        c = completed.replace(tzinfo=timezone.utc) if completed.tzinfo is None else completed
        if m > c:
            return True
    return False


def fire_meeting_brief(
    potential_id: str,
    ms_event_id: str,
    meeting_info: dict,
    triggered_by: str = "meeting_brief_lazy",
) -> CXAgentInsight | None:
    """Trigger the meeting brief graph for a potential+meeting.

    Same pattern as FU/Reply:
      - Check if research exists → create insight rows accordingly
      - meeting_brief agents identified by TriggerCategory='meeting_brief'
      - research agents identified by TabType='research'
      - Trigger AGENTFLOW_GRAPH_MEETING_BRIEF with meeting_info context

    Meeting brief insights are keyed on (potential_id, agent_id, ms_event_id)
    so each meeting gets its own insight row per agent.
    """
    now = datetime.now(timezone.utc)

    # Resolve potential_number (7-digit) — insights are keyed on this, not UUID
    potential_number = _resolve_potential_number(potential_id)

    # Skip if insight already exists and is not stale
    existing = get_meeting_brief_insight(potential_number, ms_event_id)
    if existing:
        # Already completed and not stale — no need to re-fire
        if existing.status == "completed" and not is_meeting_brief_stale(existing):
            logger.info(
                "Skipping meeting_brief trigger for %s/%s — already completed and fresh",
                potential_number, ms_event_id,
            )
            return existing
        # Still pending/running within 5-min window — throttle
        if existing.triggered_at and existing.status in ("pending", "running"):
            triggered = existing.triggered_at.replace(tzinfo=timezone.utc) if existing.triggered_at.tzinfo is None else existing.triggered_at
            seconds_since_trigger = (now - triggered).total_seconds()
            if seconds_since_trigger < 300:
                logger.info(
                    "Skipping meeting_brief trigger for %s/%s — last fired %ds ago, still %s",
                    potential_number, ms_event_id, int(seconds_since_trigger), existing.status,
                )
                return existing

    with get_session() as session:
        # Load agent configs by role
        mb_configs = session.execute(
            select(CXAgentTypeConfig).where(
                CXAgentTypeConfig.is_active == True,
                CXAgentTypeConfig.trigger_category == "meeting_brief",
            )
        ).scalars().all()
        research_configs = session.execute(
            select(CXAgentTypeConfig).where(
                CXAgentTypeConfig.is_active == True,
                CXAgentTypeConfig.tab_type == "research",
            )
        ).scalars().all()

        # Check if research already completed (using potential_number)
        research_agent_ids = {c.agent_id for c in research_configs}
        has_research = True
        if research_agent_ids:
            completed = set(session.execute(
                select(CXAgentInsight.agent_id).where(
                    CXAgentInsight.potential_id == potential_number,
                    CXAgentInsight.is_active == True,
                    CXAgentInsight.status == "completed",
                    CXAgentInsight.ms_event_id.is_(None),
                    CXAgentInsight.agent_id.in_(research_agent_ids),
                )
            ).scalars().all())
            has_research = research_agent_ids.issubset(completed)

        configs_to_fire = list(mb_configs)
        if not has_research:
            configs_to_fire = research_configs + configs_to_fire
            logger.info("fire_meeting_brief: research missing for %s — adding %d research + %d MB agents",
                         potential_number, len(research_configs), len(mb_configs))

        # Create/reset insight rows — all keyed on potential_number (7-digit)
        # Meeting brief agents additionally keyed on ms_event_id
        first_insight = None
        for cfg in configs_to_fire:
            is_mb = cfg.trigger_category == "meeting_brief"
            event_id = ms_event_id if is_mb else None

            existing_row = session.execute(
                select(CXAgentInsight).where(
                    CXAgentInsight.potential_id == potential_number,
                    CXAgentInsight.agent_id == cfg.agent_id,
                    CXAgentInsight.ms_event_id == event_id if is_mb else CXAgentInsight.ms_event_id.is_(None),
                )
            ).scalar_one_or_none()

            if existing_row:
                existing_row.status = "pending"
                existing_row.content = None
                existing_row.error_message = None
                existing_row.triggered_at = now
                existing_row.completed_time = None
                existing_row.updated_time = now
                existing_row.is_active = True
                session.add(existing_row)
                if not first_insight and is_mb:
                    first_insight = existing_row
            else:
                row = CXAgentInsight(
                    potential_id=potential_number,
                    agent_type=cfg.tab_type,
                    ms_event_id=event_id,
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
                )
                session.add(row)
                if not first_insight and is_mb:
                    first_insight = row
        session.flush()

        # Create/update "meeting-briefs" queue item so it shows as a potential card in Panel 2
        from core.models import CXQueueItem
        potential_row = session.execute(
            select(Potential, Account, Contact)
            .outerjoin(Account, Potential.account_id == Account.account_id)
            .outerjoin(Contact, Potential.contact_id == Contact.contact_id)
            .where(Potential.potential_id == potential_id)
        ).first()
        if potential_row:
            p, a, c = potential_row
            deal_title = p.potential_name or "(untitled)"
            parts = [x for x in [a.account_name if a else None, c.full_name if c else None] if x]
            subtitle = " · ".join(parts) if parts else ""
            meeting_title = meeting_info.get("title", "")
            meeting_start = meeting_info.get("start", "")

            existing_qi = session.execute(
                select(CXQueueItem).where(
                    CXQueueItem.potential_id == potential_number,
                    CXQueueItem.folder_type == "meeting-briefs",
                    CXQueueItem.status == "pending",
                    CXQueueItem.is_active == True,
                )
            ).scalar_one_or_none()

            if existing_qi:
                existing_qi.preview = meeting_title
                existing_qi.time_label = meeting_start[:16] if meeting_start else existing_qi.time_label
                existing_qi.updated_time = now
                session.add(existing_qi)
            else:
                session.add(CXQueueItem(
                    potential_id=potential_number,
                    contact_id=c.contact_id if c else None,
                    account_id=a.account_id if a else None,
                    folder_type="meeting-briefs",
                    title=deal_title,
                    subtitle=subtitle,
                    preview=meeting_title,
                    time_label=meeting_start[:16] if meeting_start else now.strftime("%Y-%m-%d"),
                    priority="normal",
                    status="pending",
                    assigned_to_user_id=p.potential_owner_id,
                    created_time=now,
                    updated_time=now,
                    is_active=True,
                ))

    # Trigger agentflow graph
    potential_data = _load_potential_data(potential_id)
    extra_attrs = {"meeting_info": meeting_info, "category": "meeting_brief"}
    logger.info("fire_meeting_brief: potential=%s ms_event_id=%s agents=%d", potential_number, ms_event_id, len(configs_to_fire))
    _trigger_agentflow(
        potential_id,
        potential_data,
        graph_id=config.AGENTFLOW_GRAPH_MEETING_BRIEF,
        extra_attrs=extra_attrs,
    )

    return first_insight


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
