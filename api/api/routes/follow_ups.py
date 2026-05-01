"""Follow-up webhooks and scheduler tick endpoint.

All three endpoints are server-to-server. Auth is via the shared
`WEBHOOK_API_KEY` header (same pattern as the agent webhook).
"""

import logging
from datetime import datetime

from fastapi import APIRouter, Body, Header

import core.config as config
from core.exceptions import BotApiException
from core.schemas import ResponseModel
from pydantic import BaseModel

from api.services.follow_up_service import (
    InboundEvent,
    OutboundEvent,
    cancel_series_on_reply,
    trigger_reply_agent,
    trigger_stage_update,
    trigger_todo_reconcile,
    process_due_schedules,
    run_inactive_followup_scan,
    run_news_scan,
    start_new_series,
)

router = APIRouter(tags=["follow_ups"])
logger = logging.getLogger(__name__)


def _require_webhook_key(x_api_key: str | None) -> None:
    if not config.WEBHOOK_API_KEY or x_api_key != config.WEBHOOK_API_KEY:
        raise BotApiException(401, "ERR_UNAUTHORIZED", "Invalid or missing API key.")


# ── Request payloads ─────────────────────────────────────────────────────────

class EmailOutboundPayload(BaseModel):
    potential_number: str
    internet_message_id: str | None = None
    sent_time: datetime
    from_email: str | None = None
    to_email: str | None = None
    subject: str | None = None


class EmailInboundPayload(BaseModel):
    potential_number: str
    received_time: datetime
    from_email: str | None = None
    internet_message_id: str | None = None          # id of the inbound reply itself
    in_reply_to_message_id: str | None = None       # id of the outbound being replied to


# ── Webhooks from the email sync service ─────────────────────────────────────

@router.post("/webhooks/email-outbound")
def post_email_outbound(
    data: EmailOutboundPayload = Body(),
    x_api_key: str | None = Header(default=None, alias="x-api-key"),
) -> ResponseModel[dict]:
    """Called by the sync service when it detects a new outbound email from a
    sales user. Starts a fresh D3/D5/D8/D12 series for the potential."""
    _require_webhook_key(x_api_key)
    result = start_new_series(OutboundEvent(
        potential_number=data.potential_number,
        internet_message_id=data.internet_message_id,
        sent_time=data.sent_time,
        from_email=data.from_email,
        to_email=data.to_email,
        subject=data.subject,
    ))
    # Stage update + todo reconcile — both run after sync table has the email
    trigger_stage_update(data.potential_number)
    trigger_todo_reconcile(data.potential_number)
    return ResponseModel(data=result)


@router.post("/webhooks/email-inbound")
def post_email_inbound(
    data: EmailInboundPayload = Body(),
    x_api_key: str | None = Header(default=None, alias="x-api-key"),
) -> ResponseModel[dict]:
    """Called by the sync service when it detects a reply from the client.
    Cancels any pending follow-up schedules and triggers the reply agent."""
    _require_webhook_key(x_api_key)
    event = InboundEvent(
        potential_number=data.potential_number,
        received_time=data.received_time,
        from_email=data.from_email,
        internet_message_id=data.internet_message_id,
        in_reply_to_message_id=data.in_reply_to_message_id,
    )
    cancel_result = cancel_series_on_reply(event)
    reply_result = trigger_reply_agent(event)
    # Stage update + todo reconcile — both run after sync table has the email
    trigger_stage_update(data.potential_number)
    trigger_todo_reconcile(data.potential_number)
    return ResponseModel(data={
        "fu_cancelled": cancel_result.get("cancelled", 0),
        "reply_agents_created": reply_result.get("agents_created", 0),
    })


# ── Scheduler tick (Cloud Scheduler → Salezilla every N minutes) ─────────────

@router.post("/internal/followups/tick")
def post_tick(
    x_api_key: str | None = Header(default=None, alias="x-api-key"),
) -> ResponseModel[dict]:
    """Called periodically by Cloud Scheduler. Processes all due pending rows."""
    _require_webhook_key(x_api_key)
    result = process_due_schedules()
    logger.info("follow_up tick: %s", result)
    return ResponseModel(data=result)


@router.post("/internal/followups/inactive-scan")
def post_inactive_scan(
    anchor_date: str | None = None,
    x_api_key: str | None = Header(default=None, alias="x-api-key"),
) -> ResponseModel[dict]:
    """Daily scan for the inactive follow-up flow.

    Scheduled daily via Cloud Scheduler; also callable manually any day.
    Finds Sleeping / Contact Later potentials whose last email (sent OR
    received, in VW_CRM_Sales_Sync_Emails) lands on the calendar day
    exactly 60 days before yesterday, and triggers the inactive follow-up
    graph for each. 1-day window means each potential is picked up at most
    once.

    anchor_date (optional, YYYY-MM-DD) — overrides "today" for the window
    calculation. Useful for back-filling missed days or testing historical
    windows.
    """
    _require_webhook_key(x_api_key)
    parsed_anchor = None
    if anchor_date:
        try:
            parsed_anchor = datetime.strptime(anchor_date, "%Y-%m-%d").date()
        except ValueError:
            raise BotApiException(400, "ERR_INVALID_DATE", "anchor_date must be YYYY-MM-DD.")
    result = run_inactive_followup_scan(parsed_anchor)
    logger.info("inactive_fu scan: %s", result)
    return ResponseModel(data=result)


@router.post("/internal/news/scan")
def post_news_scan(
    cutoff_days: int = 2,
    potential_number: str | None = None,
    x_api_key: str | None = Header(default=None, alias="x-api-key"),
) -> ResponseModel[dict]:
    """News scan.

    Default mode (no `potential_number`): Cloud Scheduler hits this daily.
    Fires the AGENTFLOW_GRAPH_NEWS graph for every active Diamond/Platinum
    potential whose `Inquired On` is within the last 60 days. Graph
    orchestrates A1 (check) → A2 (email body); empty callback = no news
    this cycle, queue item cancelled.

    `cutoff_days` (default 2) controls the agent's news-search window:
    `cutoff_date = today - cutoff_days`. Steady-state Cloud Scheduler
    should leave it at 2; widen to ~14 for a one-off first-launch backfill.

    Manual mode (`potential_number=<7-digit>`): force-trigger the news
    graph for that one potential, bypassing the eligibility filters,
    skip-if-unactioned, and the daily cap. Useful for testing / on-demand
    refresh."""
    _require_webhook_key(x_api_key)
    result = run_news_scan(cutoff_days=cutoff_days, potential_number=potential_number)
    logger.info("news scan: %s", result)
    return ResponseModel(data=result)
