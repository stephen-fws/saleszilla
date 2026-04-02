"""Agent insight endpoints — cached results and webhook receiver."""

from fastapi import APIRouter, Body, Depends, Header

import core.config as config
from core.auth import get_current_active_user
from core.exceptions import BotApiException
from core.models import User
from core.schemas import AgentInsightItem, AgentWebhookRequest, ResponseModel
from api.services.agent_service import list_agent_insights, upsert_agent_insight

router = APIRouter(tags=["agents"])


@router.get("/potentials/{potential_id}/agents")
def get_agents(
    potential_id: str,
    user: User = Depends(get_current_active_user),
) -> ResponseModel[list[AgentInsightItem]]:
    return ResponseModel(data=list_agent_insights(potential_id))


@router.post("/potentials/{potential_id}/agents/webhook")
async def agent_webhook(
    potential_id: str,
    data: AgentWebhookRequest = Body(),
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
):
    """
    Receive notification that an agent result is ready.

    The external agent system calls this endpoint after completing an agent run.
    This is a notify-then-pull model: we receive the notification, then fetch
    the actual result from the external system.

    For now, we accept the content directly in the webhook payload
    until the external agent fetch API is configured.
    """
    # Validate webhook API key if configured
    webhook_key = getattr(config, "WEBHOOK_API_KEY", "")
    if webhook_key and x_api_key != webhook_key:
        raise BotApiException(401, "ERR_UNAUTHORIZED", "Invalid API key.")

    result = upsert_agent_insight(
        potential_id=potential_id,
        agent_type=data.agent_type,
        status=data.status,
    )

    return ResponseModel(
        message_code="MSG_WEBHOOK_RECEIVED",
        data=result,
    )
