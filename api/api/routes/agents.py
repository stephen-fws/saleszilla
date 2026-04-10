"""Agent endpoints — results, webhook receiver, manual triggers."""

import logging

from fastapi import APIRouter, Body, Depends, Header, Query, BackgroundTasks

import core.config as config
from core.auth import get_current_active_user
from core.exceptions import BotApiException
from core.models import User
from core.schemas import AgentResultItem, AgentWebhookPayload, ResponseModel
from api.services.access_control import require_potential_owner
from api.services.agent_service import (
    get_all_insights,
    get_insights_for_tab,
    init_agents_for_potential,
    process_webhook,
    trigger_single_agent,
)

router = APIRouter(tags=["agents"])
logger = logging.getLogger(__name__)


def _validate_api_key(x_api_key: str | None) -> None:
    webhook_key = getattr(config, "WEBHOOK_API_KEY", "")
    if webhook_key and x_api_key != webhook_key:
        raise BotApiException(401, "ERR_UNAUTHORIZED", "Invalid API key.")


# ── Webhook (called by agent system, no JWT) ──────────────────────────────────

@router.post("/agents/webhook")
async def agent_webhook(
    background_tasks: BackgroundTasks,
    data: AgentWebhookPayload = Body(),
    x_api_key: str | None = Header(default=None, alias="x-api-key"),
):
    """Receive completion notification from agentflow. Process in background."""
    _validate_api_key(x_api_key)
    background_tasks.add_task(process_webhook, data.model_dump())
    return ResponseModel(message_code="MSG_WEBHOOK_RECEIVED", data={"ok": True})


# ── Init (called by external new-potential service) ───────────────────────────

@router.post("/potentials/{potential_id}/agents/init")
async def init_agents(
    potential_id: str,
    x_api_key: str | None = Header(default=None, alias="x-api-key"),
):
    """Trigger all agents for a potential. Called by external new-potential service."""
    _validate_api_key(x_api_key)
    init_agents_for_potential(potential_id, triggered_by="external_service")
    return ResponseModel(message_code="MSG_AGENTS_TRIGGERED", data={"ok": True})


# ── User-triggered run-all (authenticated) ───────────────────────────────────

@router.post("/potentials/{potential_id}/agents/run")
def run_agents(
    potential_id: str,
    user: User = Depends(get_current_active_user),
) -> ResponseModel[dict]:
    """Trigger all agents for a potential. Called by the UI for old potentials."""
    require_potential_owner(user.user_id, potential_id)
    init_agents_for_potential(potential_id, triggered_by="user")
    return ResponseModel(message_code="MSG_AGENTS_TRIGGERED", data={"ok": True})


# ── Results (authenticated) ───────────────────────────────────────────────────

@router.get("/potentials/{potential_id}/agent-results")
def get_agent_results(
    potential_id: str,
    tab_type: str | None = Query(default=None),
    user: User = Depends(get_current_active_user),
) -> ResponseModel[list[AgentResultItem]]:
    """Get agent results for a potential, optionally filtered by tab_type."""
    require_potential_owner(user.user_id, potential_id)
    if tab_type:
        return ResponseModel(data=get_insights_for_tab(potential_id, tab_type))
    return ResponseModel(data=get_all_insights(potential_id))


@router.post("/potentials/{potential_id}/agents/{agent_id}/trigger")
def trigger_agent(
    potential_id: str,
    agent_id: str,
    user: User = Depends(get_current_active_user),
) -> ResponseModel[AgentResultItem | None]:
    """Manually trigger a single agent for a potential."""
    require_potential_owner(user.user_id, potential_id)
    result = trigger_single_agent(potential_id, agent_id, triggered_by="user")
    if result is None:
        raise BotApiException(404, "ERR_NOT_FOUND", "Agent not found in config.")
    return ResponseModel(data=result)


# ── Legacy endpoint (keep for backward compat) ────────────────────────────────

@router.get("/potentials/{potential_id}/agents")
def get_agents_legacy(
    potential_id: str,
    user: User = Depends(get_current_active_user),
) -> ResponseModel[list[AgentResultItem]]:
    require_potential_owner(user.user_id, potential_id)
    return ResponseModel(data=get_all_insights(potential_id))
