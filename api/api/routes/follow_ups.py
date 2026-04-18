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
    process_due_schedules,
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
