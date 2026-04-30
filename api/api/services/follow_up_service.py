"""Follow-up cadence scheduling + firing.

Flow:
  1. Sync service detects an outbound from a sales user → POSTs to
     /webhooks/email-outbound → start_new_series() cancels prior pending rows
     and inserts D3/D5/D8/D12 rows in CX_FollowUpSchedule.
  2. Sync service detects a reply from client → POSTs to /webhooks/email-inbound
     → cancel_series_on_reply() cancels pending schedules for that potential.
  3. Cloud Scheduler hits /internal/followups/tick every 15 min →
     process_due_schedules() finds pending rows whose scheduled_time has
     arrived, honors the owner's working-hours window, double-checks for any
     client reply since the trigger, then calls fire_follow_up() which:
       - marks any pending next_action insights as actioned
       - upserts a pending CX_AgentInsights row for agent_id="follow_up"
       - triggers agentflow with category="follow_up" + email thread context
       - marks the schedule row fired.
  4. Agentflow callback updates the insight row with the FU draft content;
     the Next Action tab picks it up automatically.
"""

import logging
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone as tzutil
from zoneinfo import ZoneInfo

import requests
from sqlalchemy import select, text

import core.config as config
from core.database import get_session
from core.models import (
    Account, Contact, CXAgentDraftHistory, CXAgentInsight, CXAgentTypeConfig,
    CXFollowUpSchedule, CXQueueItem, CXUserToken, Potential, User,
)
# Shared website normaliser — imported here so both _load_potential_data
# implementations (agent_service + this file) scrub the same nullish sentinels.
from api.services.activity_service import log_agent_trigger
from api.services.agent_service import (
    _clean_website as _clean_website_for_agent,
    _derive_website_from_email,
    _sanitize_description,
)

logger = logging.getLogger(__name__)


FOLLOW_UP_AGENT_ID = "follow_up"
FOLLOW_UP_AGENT_NAME = "Follow Up"
CADENCE_DAYS = (3, 5, 8, 12)
DEFAULT_TIMEZONE = "Asia/Kolkata"
DEFAULT_WORKING_START = time(9, 0)
DEFAULT_WORKING_END = time(18, 0)


# ── Helpers ──────────────────────────────────────────────────────────────────

def _resolve_potential_number(session, potential_id: str) -> str | None:
    """Return the 7-digit potential_number for a given UUID."""
    return session.execute(
        select(Potential.potential_number).where(Potential.potential_id == potential_id)
    ).scalar_one_or_none()


def _resolve_potential_uuid(session, potential_number: str) -> str | None:
    """Return the potential_id UUID for a given 7-digit number."""
    return session.execute(
        select(Potential.potential_id).where(Potential.potential_number == potential_number)
    ).scalar_one_or_none()


def _parse_time(s: str | None, default: time) -> time:
    if not s:
        return default
    try:
        hh, mm = s.split(":")
        return time(int(hh), int(mm))
    except Exception:
        return default


def _within_working_hours(now_utc: datetime, tz_name: str, start: time, end: time) -> bool:
    try:
        tz = ZoneInfo(tz_name)
    except Exception:
        try:
            tz = ZoneInfo(DEFAULT_TIMEZONE)
        except Exception:
            # Environment lacks tzdata entirely (e.g. Windows without the tzdata
            # pip package). Fall back to UTC so we don't block follow-ups.
            logger.warning("No tz data available (install 'tzdata' pip); using UTC for working-hours check")
            tz = tzutil.utc
    local = now_utc.astimezone(tz).time()
    return start <= local <= end


# ── Webhook handlers ─────────────────────────────────────────────────────────

@dataclass
class OutboundEvent:
    potential_number: str
    internet_message_id: str | None
    sent_time: datetime
    from_email: str | None = None
    to_email: str | None = None
    subject: str | None = None


@dataclass
class InboundEvent:
    potential_number: str
    received_time: datetime
    from_email: str | None = None
    internet_message_id: str | None = None          # message id of the inbound reply itself
    in_reply_to_message_id: str | None = None       # message id of the outbound this reply is responding to


def start_new_series(event: OutboundEvent) -> dict:
    """On a new outbound: cancel any pending schedules for this potential and
    insert 4 new rows (D3/D5/D8/D12). Does NOT touch CX_AgentInsights —
    the old next_action stays visible until the first FU tick fires."""
    now = datetime.now(tzutil.utc)
    with get_session() as session:
        potential_uuid = _resolve_potential_uuid(session, event.potential_number)
        if not potential_uuid:
            logger.warning("start_new_series: unknown potential_number=%s", event.potential_number)
            return {"ok": False, "reason": "unknown_potential"}

        # Idempotency — if we already have a series for this exact message id, skip
        if event.internet_message_id:
            existing = session.execute(
                select(CXFollowUpSchedule).where(
                    CXFollowUpSchedule.potential_number == event.potential_number,
                    CXFollowUpSchedule.trigger_message_id == event.internet_message_id,
                    CXFollowUpSchedule.status == "pending",
                )
            ).scalars().first()
            if existing:
                logger.info("start_new_series: series already exists for msg=%s — skipping", event.internet_message_id)
                return {"ok": True, "reason": "already_exists"}

        # Cancel any existing pending schedules (old series)
        pending = session.execute(
            select(CXFollowUpSchedule).where(
                CXFollowUpSchedule.potential_number == event.potential_number,
                CXFollowUpSchedule.status == "pending",
            )
        ).scalars().all()
        for row in pending:
            row.status = "cancelled"
            row.cancel_reason = "new_series_started"
            row.updated_time = now
            session.add(row)

        # Insert 4 new rows
        for days in CADENCE_DAYS:
            session.add(CXFollowUpSchedule(
                potential_id=potential_uuid,
                potential_number=event.potential_number,
                trigger_message_id=event.internet_message_id,
                trigger_sent_time=event.sent_time,
                day_offset=days,
                scheduled_time=event.sent_time + timedelta(days=days),
                status="pending",
                created_time=now,
                updated_time=now,
            ))

    logger.info("start_new_series: created %d FU rows for potential=%s", len(CADENCE_DAYS), event.potential_number)
    return {"ok": True, "cancelled": len(pending), "created": len(CADENCE_DAYS)}


def cancel_series_on_reply(event: InboundEvent) -> dict:
    """On an inbound from the client: cancel only the pending schedule rows whose
    trigger matches the outbound message the client replied to.

    Scoping by (potential_number, trigger_message_id) avoids a race where a
    late-arriving reply to an OLDER outbound would otherwise wrongly cancel a
    newly-started series.

    If `in_reply_to_message_id` is not supplied, we do nothing here — the tick
    handler's defensive VW_CRM_Sales_Sync_Emails check will catch the reply and
    cancel the series at that point.
    """
    now = datetime.now(tzutil.utc)
    if not event.in_reply_to_message_id:
        logger.info(
            "cancel_series_on_reply: in_reply_to_message_id missing for potential=%s — deferring to tick's reply check",
            event.potential_number,
        )
        return {"ok": True, "cancelled": 0, "reason": "no_in_reply_to"}

    with get_session() as session:
        pending = session.execute(
            select(CXFollowUpSchedule).where(
                CXFollowUpSchedule.potential_number == event.potential_number,
                CXFollowUpSchedule.trigger_message_id == event.in_reply_to_message_id,
                CXFollowUpSchedule.status == "pending",
            )
        ).scalars().all()
        for row in pending:
            row.status = "cancelled"
            row.cancel_reason = "client_replied"
            row.updated_time = now
            session.add(row)

    logger.info(
        "cancel_series_on_reply: cancelled %d FU rows for potential=%s in_reply_to=%s",
        len(pending), event.potential_number, event.in_reply_to_message_id,
    )
    return {"ok": True, "cancelled": len(pending)}


def trigger_reply_agent(event: InboundEvent) -> dict:
    """On an inbound from the client: trigger the reply agent graph so a draft
    is ready for the user. Also creates the 'reply' queue item and completes
    any 'emails-sent' queue item.

    Logic mirrors the FU flow:
      - Check if research exists → create insight rows accordingly
      - Mark any pending next_action as actioned (FU draft replaced by reply draft)
      - Trigger agentflow with category='reply' + email thread context
    """
    now = datetime.now(tzutil.utc)

    with get_session() as session:
        potential_uuid = _resolve_potential_uuid(session, event.potential_number)
        if not potential_uuid:
            logger.warning("trigger_reply_agent: unknown potential=%s", event.potential_number)
            return {"ok": False, "reason": "unknown_potential"}

        # Mark any pending next_action as actioned (FU or FRE being replaced by reply)
        _mark_pending_next_actions_actioned(session, event.potential_number, now)

        # Create insight rows: research (if missing) + reply agent
        reply_configs = session.execute(
            select(CXAgentTypeConfig).where(
                CXAgentTypeConfig.is_active == True,
                CXAgentTypeConfig.trigger_category == "reply",
            )
        ).scalars().all()
        research_configs = session.execute(
            select(CXAgentTypeConfig).where(
                CXAgentTypeConfig.is_active == True,
                CXAgentTypeConfig.tab_type == "research",
            )
        ).scalars().all()

        research_agent_ids = {c.agent_id for c in research_configs}
        has_research = True
        if research_agent_ids:
            completed = set(session.execute(
                select(CXAgentInsight.agent_id).where(
                    CXAgentInsight.potential_id == event.potential_number,
                    CXAgentInsight.is_active == True,
                    CXAgentInsight.status == "completed",
                    CXAgentInsight.ms_event_id.is_(None),
                    CXAgentInsight.agent_id.in_(research_agent_ids),
                )
            ).scalars().all())
            has_research = research_agent_ids.issubset(completed)

        configs_to_fire = list(reply_configs)
        if not has_research:
            configs_to_fire = research_configs + configs_to_fire
            logger.info("trigger_reply_agent: research missing for %s — adding %d research + %d reply agents",
                         event.potential_number, len(research_configs), len(reply_configs))
        else:
            logger.info("trigger_reply_agent: research exists for %s — adding %d reply agents only",
                         event.potential_number, len(reply_configs))

        for cfg in configs_to_fire:
            _upsert_pending_insight(session, event.potential_number, cfg, now)

        # Queue item: create/update "reply" folder item, complete "emails-sent"
        potential = session.execute(
            select(Potential, Account, Contact)
            .outerjoin(Account, Potential.account_id == Account.account_id)
            .outerjoin(Contact, Potential.contact_id == Contact.contact_id)
            .where(Potential.potential_id == potential_uuid)
        ).first()

        if potential:
            p, a, c = potential
            deal_title = p.potential_name or "(untitled)"
            parts = [x for x in [a.account_name if a else None, c.full_name if c else None] if x]
            subtitle = " · ".join(parts) if parts else ""

            # Upsert reply queue item
            existing_qi = session.execute(
                select(CXQueueItem).where(
                    CXQueueItem.potential_id == event.potential_number,
                    CXQueueItem.folder_type == "reply",
                    CXQueueItem.status == "pending",
                    CXQueueItem.is_active == True,
                )
            ).scalar_one_or_none()

            if existing_qi:
                existing_qi.time_label = now.strftime("%Y-%m-%d")
                existing_qi.updated_time = now
                session.add(existing_qi)
            else:
                session.add(CXQueueItem(
                    potential_id=event.potential_number,
                    contact_id=c.contact_id if c else None,
                    account_id=a.account_id if a else None,
                    folder_type="reply",
                    title=deal_title,
                    subtitle=subtitle,
                    preview=f"Reply from {event.from_email or 'client'}",
                    time_label=now.strftime("%Y-%m-%d"),
                    priority="normal",
                    status="pending",
                    assigned_to_user_id=p.potential_owner_id,
                    created_time=now,
                    updated_time=now,
                    is_active=True,
                ))

            # Complete emails-sent + follow-up queue items
            for folder in ("emails-sent", "follow-up-active", "follow-up-inactive"):
                qi = session.execute(
                    select(CXQueueItem).where(
                        CXQueueItem.potential_id == event.potential_number,
                        CXQueueItem.folder_type == folder,
                        CXQueueItem.status == "pending",
                        CXQueueItem.is_active == True,
                    )
                ).scalar_one_or_none()
                if qi:
                    qi.status = "completed"
                    qi.updated_time = now
                    session.add(qi)

    # Trigger agentflow — fire-and-forget
    if config.AGENTFLOW_GRAPH_REPLY:
        potential_data = _load_potential_data(potential_uuid)
        email_thread = _load_email_thread(
            potential_id=potential_uuid,
            potential_number=event.potential_number,
            trigger_message_id=event.internet_message_id,
        )
        url = f"{config.AGENTFLOW_BASE_URL}/external/execute"
        attributes = {
            "customer_name": potential_data.get("customer_name", ""),
            "contact_email": potential_data.get("contact_email", ""),
            "contact_phone": potential_data.get("contact_phone", ""),
            "company_name": potential_data.get("company_name", ""),
            "company_website": potential_data.get("company_website", ""),
            "form_url": potential_data.get("form_url", ""),
            "customer_country": potential_data.get("customer_country", ""),
            "service": potential_data.get("service", ""),
            "sub_service": potential_data.get("sub_service", ""),
            "customer_requirements": potential_data.get("description", ""),
            "lead_source": potential_data.get("lead_source", ""),
            "potential_id": potential_data.get("potential_number", ""),
            "entity_owner_email": potential_data.get("owner_email", ""),
            "category": "reply",
            "client_email": event.from_email or "",
            "client_message_id": event.internet_message_id or "",
            "email_thread": email_thread,
        }
        payload = {
            "graph_id": config.AGENTFLOW_GRAPH_REPLY,
            "entity": {
                "entity_type": "sales_lead",
                "external_id": potential_data.get("potential_number", ""),
                "attributes": attributes,
            },
            "callback_connection": config.AGENTFLOW_CALLBACK_CONNECTION,
            "callback_mode": "per_agent",
        }
        logger.info("trigger_reply_agent: POST %s potential=%s", url, event.potential_number)
        log_agent_trigger(event.potential_number, "reply")
        try:
            resp = requests.post(url, json=payload, headers={"X-Api-Key": config.AGENTFLOW_API_KEY}, timeout=10)
            logger.info("reply agent agentflow response: status=%s", resp.status_code)
        except Exception as exc:
            logger.error("trigger_reply_agent: agentflow failed: %s", exc)
    else:
        logger.warning("AGENTFLOW_GRAPH_REPLY not configured — reply agent trigger skipped")

    return {"ok": True, "agents_created": len(configs_to_fire)}


# ── Stage update trigger ─────────────────────────────────────────────────────

def trigger_stage_update(potential_number: str) -> dict:
    """Fire the stage-update graph for a potential. Called from both outbound
    and inbound webhooks — the agent reads the email conversation from the
    sync table (which has the latest email by the time the webhook fires)
    and outputs stage + probability + ai_highlight."""
    now = datetime.now(tzutil.utc)

    with get_session() as session:
        potential_uuid = _resolve_potential_uuid(session, potential_number)
        if not potential_uuid:
            logger.warning("trigger_stage_update: unknown potential=%s", potential_number)
            return {"ok": False, "reason": "unknown_potential"}

        # Get stage_update agent configs
        su_configs = session.execute(
            select(CXAgentTypeConfig).where(
                CXAgentTypeConfig.is_active == True,
                CXAgentTypeConfig.trigger_category == "stage_update",
            )
        ).scalars().all()
        if not su_configs:
            return {"ok": False, "reason": "no_stage_update_agents"}

        # Upsert pending insight rows
        for cfg in su_configs:
            _upsert_pending_insight(session, potential_number, cfg, now)

    # Trigger agentflow
    if config.AGENTFLOW_GRAPH_STAGE_UPDATE:
        potential_data = _load_potential_data(potential_uuid)
        url = f"{config.AGENTFLOW_BASE_URL}/external/execute"
        payload = {
            "graph_id": config.AGENTFLOW_GRAPH_STAGE_UPDATE,
            "entity": {
                "entity_type": "sales_lead",
                "external_id": potential_number,
                "attributes": {
                    "potential_id": potential_number,
                    "customer_name": potential_data.get("customer_name", ""),
                    "contact_email": potential_data.get("contact_email", ""),
                    "contact_phone": potential_data.get("contact_phone", ""),
                    "company_name": potential_data.get("company_name", ""),
                    "company_website": potential_data.get("company_website", ""),
                    "customer_country": potential_data.get("customer_country", ""),
                    "form_url": potential_data.get("form_url", ""),
                    "service": potential_data.get("service", ""),
                    "sub_service": potential_data.get("sub_service", ""),
                    "lead_source": potential_data.get("lead_source", ""),
                    "customer_requirements": potential_data.get("description", ""),
                    "entity_owner_email": potential_data.get("owner_email", ""),
                    "category": "stage_update",
                },
            },
            "callback_connection": config.AGENTFLOW_CALLBACK_CONNECTION,
            "callback_mode": "per_agent",
        }
        logger.info("trigger_stage_update: POST %s potential=%s", url, potential_number)
        log_agent_trigger(potential_number, "stage_update")
        try:
            resp = requests.post(url, json=payload, headers={"X-Api-Key": config.AGENTFLOW_API_KEY}, timeout=10)
            logger.info("stage_update agentflow response: status=%s", resp.status_code)
        except Exception as exc:
            logger.error("trigger_stage_update: agentflow failed: %s", exc)
    else:
        logger.warning("AGENTFLOW_GRAPH_STAGE_UPDATE not configured — skipped")

    return {"ok": True, "agents_created": len(su_configs)}


def trigger_todo_reconcile(potential_number: str) -> dict:
    """Fire the todo-reconcile graph for a potential. Called from both outbound
    and inbound email webhooks. The agent reads the full email thread from the
    sync table and reconciles against the existing agent-owned todos; we pass
    those todos inline so it has the ids to reuse."""
    from api.services.todo_reconcile_service import list_agent_todos_for_trigger

    now = datetime.now(tzutil.utc)

    with get_session() as session:
        potential_uuid = _resolve_potential_uuid(session, potential_number)
        if not potential_uuid:
            logger.warning("trigger_todo_reconcile: unknown potential=%s", potential_number)
            return {"ok": False, "reason": "unknown_potential"}

        # Upsert pending insight rows for any todo_reconcile agents in config
        tr_configs = session.execute(
            select(CXAgentTypeConfig).where(
                CXAgentTypeConfig.is_active == True,
                CXAgentTypeConfig.trigger_category == "todo_reconcile",
            )
        ).scalars().all()
        for cfg in tr_configs:
            _upsert_pending_insight(session, potential_number, cfg, now)

    if not config.AGENTFLOW_GRAPH_TODO_RECONCILE:
        logger.warning("AGENTFLOW_GRAPH_TODO_RECONCILE not configured — skipped")
        return {"ok": False, "reason": "graph_not_configured"}

    existing_agent_todos = list_agent_todos_for_trigger(potential_number)
    potential_data = _load_potential_data(potential_uuid)
    url = f"{config.AGENTFLOW_BASE_URL}/external/execute"
    payload = {
        "graph_id": config.AGENTFLOW_GRAPH_TODO_RECONCILE,
        "entity": {
            "entity_type": "sales_lead",
            "external_id": potential_number,
            "attributes": {
                "potential_id": potential_number,
                "customer_name": potential_data.get("customer_name", ""),
                "contact_email": potential_data.get("contact_email", ""),
                "contact_phone": potential_data.get("contact_phone", ""),
                "company_name": potential_data.get("company_name", ""),
                "company_website": potential_data.get("company_website", ""),
                "customer_country": potential_data.get("customer_country", ""),
                "form_url": potential_data.get("form_url", ""),
                "service": potential_data.get("service", ""),
                "sub_service": potential_data.get("sub_service", ""),
                "lead_source": potential_data.get("lead_source", ""),
                "customer_requirements": potential_data.get("description", ""),
                "entity_owner_email": potential_data.get("owner_email", ""),
                "category": "todo_reconcile",
            },
        },
        # Root-level structured input for the graph — kept out of entity.attributes
        # so the array shape survives without JSON-in-string encoding.
        "input_data": {
            "existing_agent_todos": existing_agent_todos,
        },
        "callback_connection": config.AGENTFLOW_CALLBACK_CONNECTION,
        "callback_mode": "per_agent",
    }
    logger.info("trigger_todo_reconcile: POST %s potential=%s existing=%d", url, potential_number, len(existing_agent_todos))
    log_agent_trigger(potential_number, "todo_reconcile")
    try:
        resp = requests.post(url, json=payload, headers={"X-Api-Key": config.AGENTFLOW_API_KEY}, timeout=10)
        logger.info("todo_reconcile agentflow response: status=%s", resp.status_code)
    except Exception as exc:
        logger.error("trigger_todo_reconcile: agentflow failed: %s", exc)

    return {"ok": True, "agents_created": len(tr_configs), "existing_count": len(existing_agent_todos)}


# ── Follow-up Inactive (weekly scan) ─────────────────────────────────────────

def compute_inactive_scan_window(today_date: date | None = None) -> tuple[datetime, datetime]:
    """Window = the 7 calendar days ending 60 days before last week's Sunday.

    Anchoring on end-of-last-week (rather than today) means running the scan
    on any day Mon-Sun resolves to the same anchor — the current week is
    always ignored. Day-based math (60 days, not "2 months") guarantees
    each weekly run produces strict 7-day, non-overlapping slices.

    Returns (start, end_exclusive) as naive datetimes at midnight to match
    the DB's naive timestamp columns.
    """
    today = today_date or date.today()
    # weekday(): Mon=0 ... Sun=6. Days back to land on previous Sunday:
    # Mon→1, Tue→2, ..., Sat→6, Sun→7 (the Sun of last week, not today).
    last_week_end = today - timedelta(days=today.weekday() + 1)
    end_date = last_week_end - timedelta(days=60)
    start_date = end_date - timedelta(days=7)
    start = datetime.combine(start_date, time(0, 0))
    end = datetime.combine(end_date, time(0, 0))  # exclusive upper bound
    return start, end


def _trigger_inactive_fu_agentflow(potential_id: str, potential_number: str, current_stage: str) -> None:
    """Fire the inactive follow-up graph. Fire-and-forget; graph callback
    updates the insight row via /agents/webhook."""
    if not config.AGENTFLOW_GRAPH_FOLLOW_UP_INACTIVE:
        logger.warning("AGENTFLOW_GRAPH_FOLLOW_UP_INACTIVE not configured — skipped for %s", potential_number)
        return
    potential_data = _load_potential_data(potential_id)
    url = f"{config.AGENTFLOW_BASE_URL}/external/execute"
    payload = {
        "graph_id": config.AGENTFLOW_GRAPH_FOLLOW_UP_INACTIVE,
        "priority": 10,
        "entity": {
            "entity_type": "sales_lead",
            "external_id": potential_number,
            "attributes": {
                "potential_id": potential_number,
                "customer_name": potential_data.get("customer_name", ""),
                "contact_email": potential_data.get("contact_email", ""),
                "contact_phone": potential_data.get("contact_phone", ""),
                "company_name": potential_data.get("company_name", ""),
                "company_website": potential_data.get("company_website", ""),
                "customer_country": potential_data.get("customer_country", ""),
                "form_url": potential_data.get("form_url", ""),
                "service": potential_data.get("service", ""),
                "sub_service": potential_data.get("sub_service", ""),
                "lead_source": potential_data.get("lead_source", ""),
                "customer_requirements": potential_data.get("description", ""),
                "entity_owner_email": potential_data.get("owner_email", ""),
                "category": "followUpInactive",
                "current_stage": current_stage,
            },
        },
        "callback_connection": config.AGENTFLOW_CALLBACK_CONNECTION,
        "callback_mode": "per_agent",
    }
    logger.info("inactive_fu: POST %s potential=%s stage=%s", url, potential_number, current_stage)
    log_agent_trigger(potential_number, "followUpInactive")
    try:
        resp = requests.post(url, json=payload, headers={"X-Api-Key": config.AGENTFLOW_API_KEY}, timeout=10)
        logger.info("inactive_fu agentflow response: status=%s", resp.status_code)
    except Exception as exc:
        logger.error("inactive_fu: agentflow trigger failed: %s", exc)


def _fire_inactive_for_potential(snapshot: dict, now: datetime) -> None:
    """Per-potential work: upsert pending insight rows, upsert queue item in
    the follow-up-inactive folder, trigger the graph. Mirrors _fire_one() for
    active FU but scoped to the inactive flow."""
    pn = snapshot["potential_number"]
    if not pn:
        return

    with get_session() as session:
        # Previous Next Action drafts become stale — mark actioned so the new
        # inactive draft takes over once the agent webhook arrives
        _mark_pending_next_actions_actioned(session, pn, now)

        # Pending insight rows per followUpInactive agent in the config registry
        inactive_configs = session.execute(
            select(CXAgentTypeConfig).where(
                CXAgentTypeConfig.is_active == True,
                CXAgentTypeConfig.trigger_category == "followUpInactive",
            )
        ).scalars().all()
        for cfg in inactive_configs:
            _upsert_pending_insight(session, pn, cfg, now)

        # Upsert queue item in follow-up-inactive (also collapses any existing
        # follow-up-active item so the potential lives in one place)
        parts = [x for x in [snapshot["account_name"], snapshot["contact_name"]] if x]
        subtitle = " · ".join(parts) if parts else ""

        # 1:1 with trigger_category: followUpInactive → follow-up-inactive.
        # Any prior follow-up-active QI was already closed by _mark_pending_next_actions_actioned.
        existing_qi = session.execute(
            select(CXQueueItem).where(
                CXQueueItem.potential_id == pn,
                CXQueueItem.folder_type == "follow-up-inactive",
                CXQueueItem.status == "pending",
                CXQueueItem.is_active == True,
            )
        ).scalar_one_or_none()

        if existing_qi:
            existing_qi.title = snapshot["potential_name"]
            existing_qi.subtitle = subtitle
            existing_qi.time_label = now.strftime("%Y-%m-%d")
            existing_qi.updated_time = now
            session.add(existing_qi)
        else:
            session.add(CXQueueItem(
                potential_id=pn,
                contact_id=snapshot["contact_id"],
                account_id=snapshot["account_id"],
                folder_type="follow-up-inactive",
                title=snapshot["potential_name"],
                subtitle=subtitle,
                preview="Inactive follow-up",
                time_label=now.strftime("%Y-%m-%d"),
                priority="normal",
                status="pending",
                assigned_to_user_id=snapshot["owner_id"],
                created_time=now,
                updated_time=now,
                is_active=True,
            ))

    # Fire graph AFTER the DB commit — webhook later updates the insight content
    _trigger_inactive_fu_agentflow(
        potential_id=snapshot["potential_id"],
        potential_number=pn,
        current_stage=snapshot["stage"],
    )


def run_inactive_followup_scan(anchor_date: date | None = None) -> dict:
    """Weekly scan — picks Sleeping / Contact-Later potentials whose LAST
    email exchange (sent OR received, from VW_CRM_Sales_Sync_Emails) falls
    in the 7-day inactivity slice ending 60 days before last Sunday.

    Skip-if-unactioned: potentials that already have a `followUpInactive`
    insight in pending / running / completed are silently ignored, so a
    manual replay or scheduler retry inside the same week doesn't
    double-trigger.

    anchor_date: optional override for testing. When provided, the window is
    computed as if "today" were that date.
    """
    INACTIVE_STAGES = ("Sleeping", "Contact Later")
    start, end = compute_inactive_scan_window(anchor_date)
    logger.info("inactive_fu scan: window=[%s, %s) stages=%s", start.isoformat(), end.isoformat(), INACTIVE_STAGES)

    with get_session() as session:
        # Candidates: stage match + last sync-email in [start, end).
        # Raw SQL because VW_CRM_Sales_Sync_Emails has no ORM model.
        rows = session.execute(text("""
            WITH last_email AS (
                SELECT  PotentialNumber,
                        MAX(COALESCE(SentTime, ReceivedTime)) AS last_at
                FROM    VW_CRM_Sales_Sync_Emails
                WHERE   PotentialNumber IS NOT NULL
                  AND   COALESCE(SentTime, ReceivedTime) IS NOT NULL
                GROUP BY PotentialNumber
            )
            SELECT  p.[Potential Id]       AS potential_id,
                    p.[Potential Number]   AS potential_number,
                    p.[Potential Name]     AS potential_name,
                    p.Stage                AS stage,
                    p.[Potential Owner Id] AS owner_id,
                    p.[Account Id]         AS account_id,
                    p.[Contact Id]         AS contact_id,
                    a.[Account Name]       AS account_name,
                    c.[Full Name]          AS contact_name
            FROM    Potentials p
            JOIN    last_email le ON le.PotentialNumber = p.[Potential Number]
            LEFT JOIN Accounts a ON a.[Account Id] = p.[Account Id]
            LEFT JOIN Contacts c ON c.[Contact Id] = p.[Contact Id]
            WHERE   p.Stage IN ('Sleeping', 'Contact Later')
              AND   le.last_at >= :start
              AND   le.last_at <  :end
        """), {"start": start, "end": end}).all()

        candidates = [
            {
                "potential_id":     r.potential_id,
                "potential_number": r.potential_number,
                "stage":            r.stage or "",
                "owner_id":         r.owner_id,
                "potential_name":   r.potential_name or "(untitled)",
                "account_id":       r.account_id,
                "account_name":     r.account_name,
                "contact_id":       r.contact_id,
                "contact_name":     r.contact_name,
            }
            for r in rows
        ]

        # Idempotency: drop candidates that already have an unactioned
        # followUpInactive insight. Mirrors the news-flow safeguard so a
        # manual replay or scheduler retry inside the same week doesn't
        # double-trigger.
        pn_list = [c["potential_number"] for c in candidates if c["potential_number"]]
        if pn_list:
            already_rows = session.execute(
                select(CXAgentInsight.potential_id)
                .join(CXAgentTypeConfig, CXAgentInsight.agent_id == CXAgentTypeConfig.agent_id)
                .where(
                    CXAgentInsight.is_active == True,
                    CXAgentInsight.potential_id.in_(pn_list),
                    CXAgentInsight.status.in_(("pending", "running", "completed")),
                    CXAgentTypeConfig.trigger_category == "followUpInactive",
                )
                .distinct()
            ).all()
            already_processed = {r[0] for r in already_rows}
            if already_processed:
                logger.info("inactive_fu scan: skipping %d already-processed potentials", len(already_processed))
            candidates = [c for c in candidates if c["potential_number"] not in already_processed]

    now = datetime.now(tzutil.utc)
    triggered = skipped = 0
    for s in candidates:
        if not s["potential_number"]:
            skipped += 1
            logger.warning("inactive_fu scan: skipping potential with no potential_number: %s", s["potential_id"])
            continue
        try:
            _fire_inactive_for_potential(s, now)
            triggered += 1
        except Exception:
            logger.exception("inactive_fu scan: failed for potential=%s", s["potential_number"])
            skipped += 1

    return {
        "ok": True,
        "window_start": start.isoformat(),
        "window_end": end.isoformat(),
        "matched": len(candidates),
        "triggered": triggered,
        "skipped": skipped,
    }


# ── News (daily Diamond/Platinum scan) ───────────────────────────────────────


def _trigger_news_agentflow(potential_id: str, potential_number: str, category: str) -> None:
    """Fire the news graph for one potential. Fire-and-forget.

    The graph orchestrates A1 (news-check) → A2 (email body). A1's callback
    tells Salezilla whether A2 will run; if A1 returns `news_selected: false`
    we close out A2's pending insight. Otherwise A2's callback arrives later
    with the email body that becomes the Next Action draft.

    cutoff_date is passed under input_data so the agent's "news from the last
    2 days (after {cutoff_date})" prompt has a deterministic server-controlled
    boundary (= run-date − 2 days). Avoids any ambiguity about which clock
    agentflow would otherwise use.
    """
    if not config.AGENTFLOW_GRAPH_NEWS:
        logger.warning("AGENTFLOW_GRAPH_NEWS not configured — skipped for %s", potential_number)
        return
    potential_data = _load_potential_data(potential_id)
    today = date.today()
    cutoff_date = today - timedelta(days=2)
    url = f"{config.AGENTFLOW_BASE_URL}/external/execute"
    payload = {
        "graph_id": config.AGENTFLOW_GRAPH_NEWS,
        "entity": {
            "entity_type": "sales_lead",
            "external_id": potential_number,
            "attributes": {
                "potential_id": potential_number,
                "customer_name": potential_data.get("customer_name", ""),
                "contact_email": potential_data.get("contact_email", ""),
                "contact_phone": potential_data.get("contact_phone", ""),
                "company_name": potential_data.get("company_name", ""),
                "company_website": potential_data.get("company_website", ""),
                "customer_country": potential_data.get("customer_country", ""),
                "form_url": potential_data.get("form_url", ""),
                "service": potential_data.get("service", ""),
                "sub_service": potential_data.get("sub_service", ""),
                "lead_source": potential_data.get("lead_source", ""),
                "customer_requirements": potential_data.get("description", ""),
                "entity_owner_email": potential_data.get("owner_email", ""),
                "category": "news",
                "potential_category": category,  # "Diamond" | "Platinum"
            },
        },
        # Root-level structured input the graph can consume directly
        "input_data": {
            "today_date": today.isoformat(),
            "cutoff_date": cutoff_date.isoformat(),
        },
        "callback_connection": config.AGENTFLOW_CALLBACK_CONNECTION,
        "callback_mode": "per_agent",
    }
    logger.info("news: POST %s potential=%s category=%s cutoff=%s", url, potential_number, category, cutoff_date.isoformat())
    log_agent_trigger(potential_number, "news")
    try:
        resp = requests.post(url, json=payload, headers={"X-Api-Key": config.AGENTFLOW_API_KEY}, timeout=10)
        logger.info("news agentflow response: status=%s", resp.status_code)
    except Exception as exc:
        logger.error("news: agentflow trigger failed: %s", exc)




def _fire_news_for_potential(snapshot: dict, now: datetime) -> None:
    """Per-potential work: upsert pending insight rows + queue item + fire graph."""
    pn = snapshot["potential_number"]
    if not pn:
        return

    with get_session() as session:
        # A new action is taking over — supersede any prior unactioned non-
        # meeting-brief action (FRE/FU/reply) and close its QI. Meeting-briefs
        # untouched (they coexist with whatever news surfaces).
        _mark_pending_next_actions_actioned(session, pn, now)

        news_configs = session.execute(
            select(CXAgentTypeConfig).where(
                CXAgentTypeConfig.is_active == True,
                CXAgentTypeConfig.trigger_category == "news",
            )
        ).scalars().all()
        for cfg in news_configs:
            _upsert_pending_insight(session, pn, cfg, now)

        # Upsert queue item in the "news" folder.
        # NOTE: empty-content webhook later will cancel this item ("no news
        # this cycle") so the folder doesn't clutter with false positives.
        parts = [x for x in [snapshot["account_name"], snapshot["contact_name"]] if x]
        subtitle = " · ".join(parts) if parts else ""

        existing_qi = session.execute(
            select(CXQueueItem).where(
                CXQueueItem.potential_id == pn,
                CXQueueItem.folder_type == "news",
                CXQueueItem.status == "pending",
                CXQueueItem.is_active == True,
            )
        ).scalar_one_or_none()

        if existing_qi:
            existing_qi.title = snapshot["potential_name"]
            existing_qi.subtitle = subtitle
            existing_qi.time_label = now.strftime("%Y-%m-%d")
            existing_qi.updated_time = now
            session.add(existing_qi)
        else:
            session.add(CXQueueItem(
                potential_id=pn,
                contact_id=snapshot["contact_id"],
                account_id=snapshot["account_id"],
                folder_type="news",
                title=snapshot["potential_name"],
                subtitle=subtitle,
                preview=f"{snapshot['category']} — checking news",
                time_label=now.strftime("%Y-%m-%d"),
                priority="normal",
                status="pending",
                assigned_to_user_id=snapshot["owner_id"],
                created_time=now,
                updated_time=now,
                is_active=True,
            ))

    _trigger_news_agentflow(
        potential_id=snapshot["potential_id"],
        potential_number=pn,
        category=snapshot["category"],
    )


def run_news_scan() -> dict:
    """Daily scan: fire the news graph for every active Diamond or Platinum
    potential, skipping any where a recent news insight is still in-flight or
    waiting on the user.

    Stages excluded: Closed / Lost / Disqualified / Not an Inquiry / Low Value —
    no point fetching news on dead deals. Sleeping and Contact Later stay in —
    news is often what reactivates a parked Diamond deal.

    Skip rule (prevents the 2-day agent overlap from wiping a pending draft):
      Skip if ANY news insight exists with status IN ('pending','running','completed')
      — i.e., still working OR user hasn't actioned it yet.
      Fire if status is 'actioned'/'cancelled'/'error', or no news insight exists.
    """
    EXCLUDED_STAGES = ("Closed", "Lost", "Disqualified", "Not an Inquiry", "Low Value")

    with get_session() as session:
        # Diamond = potential2close == 1, Platinum = hot_potential == 'true'.
        # `Hot_Potential` is a string column (Zoho legacy), so compare as lowercase.
        rows = session.execute(
            select(Potential, Account, Contact)
            .outerjoin(Account, Potential.account_id == Account.account_id)
            .outerjoin(Contact, Potential.contact_id == Contact.contact_id)
            .where(
                (Potential.potential2close == 1) | (Potential.hot_potential.ilike("true")),
                Potential.stage.notin_(EXCLUDED_STAGES),
            )
        ).all()

        snapshots = []
        for p, a, c in rows:
            category = "Diamond" if (p.potential2close or 0) == 1 else "Platinum"
            snapshots.append({
                "potential_id": p.potential_id,
                "potential_number": p.potential_number,
                "category": category,
                "owner_id": p.potential_owner_id,
                "potential_name": p.potential_name or "(untitled)",
                "account_name": a.account_name if a else None,
                "contact_name": c.full_name if c else None,
                "contact_id": c.contact_id if c else None,
                "account_id": a.account_id if a else None,
            })

        # Pre-filter: pull potentials that already have an in-flight / unactioned
        # news insight so we skip them this cycle.
        pns = [s["potential_number"] for s in snapshots if s["potential_number"]]
        busy_pns: set[str] = set()
        if pns:
            busy_rows = session.execute(
                select(CXAgentInsight.potential_id)
                .join(CXAgentTypeConfig, CXAgentInsight.agent_id == CXAgentTypeConfig.agent_id)
                .where(
                    CXAgentInsight.potential_id.in_(pns),
                    CXAgentInsight.is_active == True,
                    CXAgentInsight.status.in_(("pending", "running", "completed")),
                    CXAgentTypeConfig.trigger_category == "news",
                )
            ).all()
            busy_pns = {r[0] for r in busy_rows}

    logger.info("news scan: matched=%d busy=%d", len(snapshots), len(busy_pns))
    now = datetime.now(tzutil.utc)
    triggered = skipped = already_pending = 0
    for s in snapshots:
        pn = s["potential_number"]
        if not pn:
            skipped += 1
            continue
        if pn in busy_pns:
            already_pending += 1
            continue
        try:
            _fire_news_for_potential(s, now)
            triggered += 1
        except Exception:
            logger.exception("news scan: failed for potential=%s", pn)
            skipped += 1

    return {
        "ok": True,
        "matched": len(snapshots),
        "triggered": triggered,
        "already_pending": already_pending,
        "skipped": skipped,
    }


# ── Tick processing ──────────────────────────────────────────────────────────

def _has_client_reply_since(potential_number: str, since: datetime) -> bool:
    """Defensive re-check against VW_CRM_Sales_Sync_Emails — has any inbound
    (non-sales-user) email arrived for this potential after `since`?"""
    with get_session() as session:
        # Sales user emails (from Users + CX_UserTokens)
        sales_emails_rows = session.execute(
            select(User.email).where(User.is_active == True)
        ).all()
        ms_email_rows = session.execute(
            select(CXUserToken.ms_email).where(
                CXUserToken.is_active == True,
                CXUserToken.ms_email.is_not(None),
            )
        ).all()
        sales_emails = {r[0].lower() for r in sales_emails_rows if r[0]}
        sales_emails.update({r[0].lower() for r in ms_email_rows if r[0]})

        rows = session.execute(text("""
            SELECT TOP 50 [From], ReceivedTime
            FROM VW_CRM_Sales_Sync_Emails
            WHERE PotentialNumber = :pn
              AND ReceivedTime > :since
            ORDER BY ReceivedTime DESC
        """), {"pn": potential_number, "since": since}).all()

    for from_addr, _ in rows:
        if from_addr and from_addr.lower() not in sales_emails:
            return True
    return False


def _load_email_thread_from_view(potential_number: str, limit: int = 20) -> list[dict]:
    """Fallback — fetch the last N emails for this potential from the sync view."""
    with get_session() as session:
        sales_emails_rows = session.execute(
            select(User.email).where(User.is_active == True)
        ).all()
        ms_email_rows = session.execute(
            select(CXUserToken.ms_email).where(
                CXUserToken.is_active == True,
                CXUserToken.ms_email.is_not(None),
            )
        ).all()
        sales_emails = {r[0].lower() for r in sales_emails_rows if r[0]}
        sales_emails.update({r[0].lower() for r in ms_email_rows if r[0]})

        rows = session.execute(text("""
            SELECT TOP (:lim)
                [From], [To], cc, subject, ReceivedTime, SentTime, UniqueBody,
                InternetMessageId
            FROM VW_CRM_Sales_Sync_Emails
            WHERE PotentialNumber = :pn
            ORDER BY COALESCE(SentTime, ReceivedTime) DESC
        """), {"pn": potential_number, "lim": limit}).all()

    out: list[dict] = []
    for from_addr, to_addr, cc, subject, received, sent, body, msg_id in rows:
        direction = "outbound" if (from_addr and from_addr.lower() in sales_emails) else "inbound"
        out.append({
            "direction": direction,
            "from": from_addr or "",
            "to": to_addr or "",
            "cc": cc or "",
            "subject": subject or "",
            "sent_time": sent.isoformat() if sent else None,
            "received_time": received.isoformat() if received else None,
            "body": (body or "")[:4000],
            "message_id": msg_id or None,
        })
    out.reverse()
    return out


def _load_email_thread(
    potential_id: str,
    potential_number: str,
    trigger_message_id: str | None,
    limit: int = 20,
) -> list[dict]:
    """Load the email thread for the FU agent from the sync table."""
    return _load_email_thread_from_view(potential_number, limit=limit)


def _get_owner_working_window(session, potential_id: str) -> tuple[str, time, time]:
    """Return (timezone_name, start_time, end_time) for the potential owner."""
    row = session.execute(
        select(CXUserToken.timezone, CXUserToken.working_hours_start, CXUserToken.working_hours_end)
        .join(Potential, Potential.potential_owner_id == CXUserToken.user_id)
        .where(Potential.potential_id == potential_id, CXUserToken.is_active == True)
        .limit(1)
    ).first()
    if not row:
        return DEFAULT_TIMEZONE, DEFAULT_WORKING_START, DEFAULT_WORKING_END
    tz_name, start_s, end_s = row
    return (
        tz_name or DEFAULT_TIMEZONE,
        _parse_time(start_s, DEFAULT_WORKING_START),
        _parse_time(end_s, DEFAULT_WORKING_END),
    )


def _load_potential_data(potential_id: str) -> dict:
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
            # Account.website is rarely populated; fall back to the contact
            # email's domain (free providers excluded). Same logic as agent_service.
            "company_website": (
                _clean_website_for_agent(a.website if a else "")
                or _derive_website_from_email(c.email if c else "")
            ),
            "description": _sanitize_description(p.description),
            "lead_source": p.lead_source or "",
            "form_url": _clean_website_for_agent(p.form_url),
            "potential_number": p.potential_number or "",
        }


# Queue folders whose lifecycle is tied to non-meeting-brief next_action
# insights. When a new action supersedes a prior one, the pending QI in any of
# these folders closes. Meeting-briefs is intentionally excluded — it coexists
# with other actions and only closes via its own expiry/resolve paths.
_SKIPPABLE_FOLDERS = (
    "new-inquiries",
    "follow-up-active",
    "follow-up-inactive",
    "reply",
    "news",
)


def _mark_pending_next_actions_actioned(session, potential_number: str, now: datetime) -> int:
    """Supersede any prior unactioned next_action for this potential when a new
    action fires.

    Design rule: at most ONE active next_action per potential at a time, EXCEPT
    `meeting_brief` which is additive (coexists with whatever else is in flight
    and never supersedes or gets superseded at fire-time).

    On call:
      - All non-meeting-brief next_action insights that aren't already
        actioned/skipped get status='skipped' (audit-logged via _snapshot_draft
        with resolution='skipped').
      - Their corresponding queue items in the non-meeting folders (listed in
        _SKIPPABLE_FOLDERS) get status='skipped' too — the new trigger will
        create its own pending QI right after.

    Meeting-brief insights and the meeting-briefs queue item are never touched.
    """
    rows = session.execute(
        select(CXAgentInsight)
        .join(CXAgentTypeConfig, CXAgentInsight.agent_id == CXAgentTypeConfig.agent_id)
        .where(
            CXAgentInsight.potential_id == potential_number,
            CXAgentTypeConfig.tab_type == "next_action",
            CXAgentTypeConfig.trigger_category != "meeting_brief",
            CXAgentInsight.status.notin_(("actioned", "skipped")),
            CXAgentInsight.is_active == True,
        )
    ).scalars().all()
    for r in rows:
        _snapshot_draft(session, r, "skipped", now)
        r.status = "skipped"
        r.updated_time = now
        session.add(r)

    # Close the matching pending queue items (excluding meeting-briefs)
    qis = session.execute(
        select(CXQueueItem).where(
            CXQueueItem.potential_id == potential_number,
            CXQueueItem.folder_type.in_(_SKIPPABLE_FOLDERS),
            CXQueueItem.status == "pending",
            CXQueueItem.is_active == True,
        )
    ).scalars().all()
    for qi in qis:
        qi.status = "skipped"
        qi.updated_time = now
        session.add(qi)

    return len(rows)


def _snapshot_draft(session, insight: CXAgentInsight, resolution: str, now: datetime) -> None:
    """Snapshot the current insight content to CX_AgentDraftHistory before overwriting."""
    if not insight.content:
        return
    session.add(CXAgentDraftHistory(
        potential_id=insight.potential_id,
        agent_id=insight.agent_id,
        agent_name=insight.agent_name,
        trigger_category=insight.agent_type,
        content=insight.content,
        status=insight.status,
        resolution=resolution,
        triggered_at=insight.triggered_at,
        completed_at=insight.completed_time,
        resolved_at=now,
        created_time=now,
    ))


def _upsert_pending_insight(session, potential_number: str, cfg: CXAgentTypeConfig, now: datetime) -> CXAgentInsight:
    """Create or reset a single insight row to pending. Snapshots old content before overwriting."""
    existing = session.execute(
        select(CXAgentInsight).where(
            CXAgentInsight.potential_id == potential_number,
            CXAgentInsight.agent_id == cfg.agent_id,
            CXAgentInsight.ms_event_id.is_(None),
        )
    ).scalar_one_or_none()

    if existing:
        _snapshot_draft(session, existing, "overwritten", now)
        existing.status = "pending"
        existing.content = None
        existing.error_message = None
        existing.triggered_at = now
        existing.completed_time = None
        existing.updated_time = now
        existing.is_active = True
        session.add(existing)
        session.flush()
        return existing

    row = CXAgentInsight(
        potential_id=potential_number,
        agent_type=cfg.tab_type,
        agent_id=cfg.agent_id,
        agent_name=cfg.agent_name,
        content=None,
        content_type=cfg.content_type,
        status="pending",
        triggered_at=now,
        requested_time=now,
        created_time=now,
        updated_time=now,
        is_active=True,
    )
    session.add(row)
    session.flush()
    return row


def _create_fu_insight_rows(session, potential_number: str, now: datetime) -> int:
    """Create pending insight rows for a follow-up firing.

    Checks if research agents have already completed for this potential.
    - If YES → create pending rows for FU agents only (TriggerCategory='followUp')
    - If NO  → create pending rows for research agents (TabType='research') + FU agents

    Returns the number of rows created/reset.
    """
    # Load agent configs by role
    all_configs = session.execute(
        select(CXAgentTypeConfig).where(CXAgentTypeConfig.is_active == True)
    ).scalars().all()

    research_configs = [c for c in all_configs if c.tab_type == "research"]
    fu_configs = [c for c in all_configs if c.trigger_category == "followUp"]

    # Check if research is already completed for this potential
    research_agent_ids = {c.agent_id for c in research_configs}
    if research_agent_ids:
        completed_research = set(session.execute(
            select(CXAgentInsight.agent_id).where(
                CXAgentInsight.potential_id == potential_number,
                CXAgentInsight.is_active == True,
                CXAgentInsight.status == "completed",
                CXAgentInsight.ms_event_id.is_(None),
                CXAgentInsight.agent_id.in_(research_agent_ids),
            )
        ).scalars().all())
        has_research = research_agent_ids.issubset(completed_research)
    else:
        has_research = True

    # Decide which agents to create pending rows for
    configs_to_fire = list(fu_configs)
    if not has_research:
        configs_to_fire = research_configs + configs_to_fire
        logger.info("follow_up: research missing for %s — adding %d research + %d FU agents",
                     potential_number, len(research_configs), len(fu_configs))
    else:
        logger.info("follow_up: research exists for %s — adding %d FU agents only",
                     potential_number, len(fu_configs))

    for cfg in configs_to_fire:
        _upsert_pending_insight(session, potential_number, cfg, now)

    return len(configs_to_fire)


def _trigger_followup_agentflow(potential_data: dict, day_offset: int, email_thread: list[dict], trigger_message_id: str | None) -> None:
    if not config.AGENTFLOW_GRAPH_FOLLOW_UP:
        logger.warning("AGENTFLOW_GRAPH_FOLLOW_UP not configured — follow-up trigger skipped")
        return

    url = f"{config.AGENTFLOW_BASE_URL}/external/execute"
    potential_number = potential_data.get("potential_number") or ""
    attributes = {
        "customer_name": potential_data.get("customer_name", ""),
        "contact_email": potential_data.get("contact_email", ""),
        "contact_phone": potential_data.get("contact_phone", ""),
        "company_name": potential_data.get("company_name", ""),
        "company_website": potential_data.get("company_website", ""),
        "form_url": potential_data.get("form_url", ""),
        "customer_country": potential_data.get("customer_country", ""),
        "service": potential_data.get("service", ""),
        "sub_service": potential_data.get("sub_service", ""),
        "customer_requirements": potential_data.get("description", ""),
        "lead_source": potential_data.get("lead_source", ""),
        "potential_id": potential_number,
        "entity_owner_email": potential_data.get("owner_email", ""),
        "category": "follow_up",
        "day_offset": day_offset,
        "trigger_message_id": trigger_message_id or "",
        "email_thread": email_thread,
    }

    payload = {
        "graph_id": config.AGENTFLOW_GRAPH_FOLLOW_UP,
        "entity": {
            "entity_type": "sales_lead",
            "external_id": potential_number,
            "attributes": attributes,
        },
        "callback_connection": config.AGENTFLOW_CALLBACK_CONNECTION,
        "callback_mode": "per_agent",
    }
    logger.info("follow_up: POST %s day=%d potential=%s", url, day_offset, potential_number)
    log_agent_trigger(potential_number, "followUp")
    try:
        resp = requests.post(url, json=payload, headers={"X-Api-Key": config.AGENTFLOW_API_KEY}, timeout=10)
        logger.info("follow_up agentflow response: status=%s", resp.status_code)
    except Exception as exc:
        logger.error("follow_up: agentflow trigger failed: %s", exc)


def _fire_one(schedule_row: CXFollowUpSchedule) -> str:
    """Fire a single due schedule. Returns one of: fired / cancelled.
    ("deferred" is no longer returned — working-hours gating was removed since
    the tick only prepares drafts; send timing is the user's decision.)"""
    now = datetime.now(tzutil.utc)

    # Defensive re-check: client reply since the trigger?
    if _has_client_reply_since(schedule_row.potential_number, schedule_row.trigger_sent_time):
        with get_session() as session:
            row = session.get(CXFollowUpSchedule, schedule_row.id)
            if row:
                row.status = "cancelled"
                row.cancel_reason = "client_replied"
                row.updated_time = now
                session.add(row)
            # Cancel the rest of the series too
            others = session.execute(
                select(CXFollowUpSchedule).where(
                    CXFollowUpSchedule.potential_number == schedule_row.potential_number,
                    CXFollowUpSchedule.status == "pending",
                )
            ).scalars().all()
            for r in others:
                r.status = "cancelled"
                r.cancel_reason = "client_replied"
                r.updated_time = now
                session.add(r)
        return "cancelled"

    # No working-hours gate here: the tick only PREPARES a draft, it doesn't
    # auto-send. Deferring would leave the draft un-prepared when the user logs
    # in the next morning. Let it fire any time — the user sends on their own clock.

    # Fire: mark next_action actioned → create insight rows → queue item → trigger graph
    INACTIVE_STAGES = {"Sleeping", "Contact Later"}

    with get_session() as session:
        _mark_pending_next_actions_actioned(session, schedule_row.potential_number, now)
        _create_fu_insight_rows(session, schedule_row.potential_number, now)

        # Create/update queue item in the right follow-up folder
        potential = session.execute(
            select(Potential, Account, Contact)
            .outerjoin(Account, Potential.account_id == Account.account_id)
            .outerjoin(Contact, Potential.contact_id == Contact.contact_id)
            .where(Potential.potential_id == schedule_row.potential_id)
        ).first()

        if potential:
            p, a, c = potential
            # Active FU always lives in follow-up-active. The separate
            # followUpInactive trigger_category (weekly scan) owns follow-up-inactive.
            # Folder routing is 1:1 with trigger_category — never branches on stage.
            folder = "follow-up-active"
            deal_title = p.potential_name or "(untitled)"
            company = a.account_name if a else None
            contact_name = c.full_name if c else None
            parts = [x for x in [company, contact_name] if x]
            subtitle = " · ".join(parts) if parts else ""

            # Upsert: one pending queue item per potential in the active-FU folder
            existing_qi = session.execute(
                select(CXQueueItem).where(
                    CXQueueItem.potential_id == schedule_row.potential_number,
                    CXQueueItem.folder_type == "follow-up-active",
                    CXQueueItem.status == "pending",
                    CXQueueItem.is_active == True,
                )
            ).scalar_one_or_none()

            if existing_qi:
                existing_qi.title = deal_title
                existing_qi.subtitle = subtitle
                existing_qi.time_label = now.strftime("%Y-%m-%d")
                existing_qi.updated_time = now
                session.add(existing_qi)
            else:
                session.add(CXQueueItem(
                    potential_id=schedule_row.potential_number,
                    contact_id=c.contact_id if c else None,
                    account_id=a.account_id if a else None,
                    folder_type=folder,
                    title=deal_title,
                    subtitle=subtitle,
                    preview=f"Follow-up D{schedule_row.day_offset}",
                    time_label=now.strftime("%Y-%m-%d"),
                    priority="normal",
                    status="pending",
                    assigned_to_user_id=p.potential_owner_id,
                    created_time=now,
                    updated_time=now,
                    is_active=True,
                ))

            # Complete any "emails-sent" queue item — potential is moving to follow-up
            emails_sent_qi = session.execute(
                select(CXQueueItem).where(
                    CXQueueItem.potential_id == schedule_row.potential_number,
                    CXQueueItem.folder_type == "emails-sent",
                    CXQueueItem.status == "pending",
                    CXQueueItem.is_active == True,
                )
            ).scalar_one_or_none()
            if emails_sent_qi:
                emails_sent_qi.status = "completed"
                emails_sent_qi.updated_time = now
                session.add(emails_sent_qi)

        row = session.get(CXFollowUpSchedule, schedule_row.id)
        if row:
            row.status = "fired"
            row.fired_time = now
            row.updated_time = now
            session.add(row)

    # Agentflow call happens AFTER DB commit — fire-and-forget, webhook will update the insight
    potential_data = _load_potential_data(schedule_row.potential_id)
    email_thread = _load_email_thread(
        potential_id=schedule_row.potential_id,
        potential_number=schedule_row.potential_number,
        trigger_message_id=schedule_row.trigger_message_id,
    )
    _trigger_followup_agentflow(
        potential_data=potential_data,
        day_offset=schedule_row.day_offset,
        email_thread=email_thread,
        trigger_message_id=schedule_row.trigger_message_id,
    )
    return "fired"


def process_due_schedules(limit: int = 100) -> dict:
    """Called by Cloud Scheduler every N minutes. Processes up to `limit` due rows."""
    now = datetime.now(tzutil.utc)
    with get_session() as session:
        due_rows = session.execute(
            select(CXFollowUpSchedule)
            .where(
                CXFollowUpSchedule.status == "pending",
                CXFollowUpSchedule.scheduled_time <= now,
            )
            .order_by(CXFollowUpSchedule.scheduled_time)
            .limit(limit)
        ).scalars().all()
        # Detach — we'll re-fetch per row inside _fire_one
        due_list = [(r.id, r.potential_id, r.potential_number, r.day_offset, r.trigger_sent_time, r.trigger_message_id) for r in due_rows]

    fired = cancelled = deferred = 0
    for (rid, pid, pn, days, trig, tmid) in due_list:
        # Build a lightweight shim; _fire_one re-fetches the row for updates
        shim = CXFollowUpSchedule(
            id=rid, potential_id=pid, potential_number=pn, day_offset=days,
            trigger_sent_time=trig, trigger_message_id=tmid,
            scheduled_time=now, status="pending",
            created_time=now, updated_time=now,
        )
        try:
            result = _fire_one(shim)
        except Exception as exc:
            logger.exception("follow_up: _fire_one failed for schedule id=%s: %s", rid, exc)
            continue
        if result == "fired":
            fired += 1
        elif result == "cancelled":
            cancelled += 1
        elif result == "deferred":
            deferred += 1

    return {
        "ok": True,
        "scanned": len(due_list),
        "fired": fired,
        "cancelled": cancelled,
        "deferred": deferred,
    }
