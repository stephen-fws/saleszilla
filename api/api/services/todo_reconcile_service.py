"""Reconcile agent-produced todos against CX_Todos.

Trigger flow (see follow_up_service.trigger_todo_reconcile):
  1. An inbound/outbound email webhook fires.
  2. Salezilla POSTs the todo_reconcile graph with the potential context + the
     current list of agent-owned todos (id, text, status).
  3. The graph reads the email thread, returns a JSON array of the updated
     reconciled list. Each item may carry an existing id (reuse) or omit it (new).
  4. Webhook arrives → process_webhook → reconcile_from_agent() (this module).

Reconcile rules:
  - Item with id matching an existing agent-owned row → update text if changed.
    If the existing row is done/cancelled, we keep it (never revive closed tasks).
  - Item without id → insert as new agent-owned row (status=pending).
  - Existing agent-owned row whose id the LLM did NOT return → soft-delete
    (task no longer relevant per latest thread).
  - Rows with source="user" are NEVER touched — agent doesn't even see them.
"""

import json as _json
import logging
from datetime import datetime, timezone

from sqlalchemy import select

from core.database import get_session
from core.models import CXTodo

logger = logging.getLogger(__name__)


def list_agent_todos_for_trigger(potential_number: str) -> list[dict]:
    """Return the current agent-owned todos in a shape the graph can digest.
    CX_Todos.potential_id stores the 7-digit potential_number (business key)."""
    with get_session() as session:
        rows = session.execute(
            select(CXTodo).where(
                CXTodo.potential_id == potential_number,
                CXTodo.is_active == True,
                CXTodo.source == "agent",
            ).order_by(CXTodo.id.asc())
        ).scalars().all()
        return [{"id": t.id, "text": t.text, "status": t.status} for t in rows]


def _strip_markdown_fence(content: str) -> str:
    """Strip a leading ```<lang> fence and trailing ``` so `json.loads` accepts
    LLM responses that wrap their JSON in a code fence."""
    stripped = content.strip()
    if not stripped.startswith("```"):
        return content
    first_nl = stripped.find("\n")
    if first_nl == -1:
        return content
    body = stripped[first_nl + 1:]
    if body.rstrip().endswith("```"):
        body = body.rstrip()[:-3]
    return body.strip()


def reconcile_from_agent(potential_number: str, content: str) -> dict:
    """Parse the agent's JSON response and reconcile CX_Todos. Returns a summary dict.

    Expected content shape (JSON array, optionally wrapped in a ```json fence):
        [
          {"id": 42, "text": "Send finalized contract"},  // match by id, update text
          {"id": 44, "text": "Confirm pricing approach"}, // match by id, no text change
          {"text": "Arrange payment milestones"}          // new (no id)
        ]

    Missing ids from the input (compared to what we currently have) are treated
    as "no longer relevant" → soft-deleted.
    """
    cleaned = _strip_markdown_fence(content or "")
    try:
        proposed = _json.loads(cleaned)
    except (ValueError, TypeError):
        logger.warning("todo_reconcile: invalid JSON for potential=%s: %s", potential_number, cleaned[:200])
        return {"ok": False, "reason": "invalid_json"}

    if not isinstance(proposed, list):
        logger.warning("todo_reconcile: expected JSON array, got %s for potential=%s", type(proposed).__name__, potential_number)
        return {"ok": False, "reason": "not_an_array"}

    now = datetime.now(timezone.utc)
    updated = inserted = deleted = skipped = 0

    with get_session() as session:
        # Load current agent-owned rows for this potential (active only).
        # Key is potential_number (7-digit) — same as CX_QueueItems / CX_AgentInsights.
        existing_rows = session.execute(
            select(CXTodo).where(
                CXTodo.potential_id == potential_number,
                CXTodo.is_active == True,
                CXTodo.source == "agent",
            )
        ).scalars().all()
        by_id = {t.id: t for t in existing_rows}

        seen_ids: set[int] = set()

        for item in proposed:
            if not isinstance(item, dict):
                skipped += 1
                continue
            text = (item.get("text") or "").strip()
            if not text:
                skipped += 1
                continue

            raw_id = item.get("id")
            maybe_id: int | None = None
            if isinstance(raw_id, int):
                maybe_id = raw_id
            elif isinstance(raw_id, str) and raw_id.isdigit():
                maybe_id = int(raw_id)

            if maybe_id is not None and maybe_id in by_id:
                row = by_id[maybe_id]
                seen_ids.add(row.id)
                # Don't revive closed rows — user's resolution wins over agent
                if row.status in ("done", "cancelled"):
                    continue
                if row.text != text:
                    row.text = text
                    row.updated_time = now
                    session.add(row)
                    updated += 1
                continue

            # New agent todo
            session.add(CXTodo(
                potential_id=potential_number,
                text=text,
                status="pending",
                is_completed=False,
                source="agent",
                created_by_user_id=None,
                created_time=now,
                updated_time=now,
                is_active=True,
            ))
            inserted += 1

        # Soft-delete agent rows the LLM didn't return — only if they're still
        # open. Closed (done/cancelled) rows stay as-is.
        for rid, row in by_id.items():
            if rid in seen_ids:
                continue
            if row.status in ("done", "cancelled"):
                continue
            row.is_active = False
            row.updated_time = now
            session.add(row)
            deleted += 1

    logger.info(
        "todo_reconcile: potential=%s proposed=%d updated=%d inserted=%d deleted=%d skipped=%d",
        potential_number, len(proposed), updated, inserted, deleted, skipped,
    )
    return {"ok": True, "updated": updated, "inserted": inserted, "deleted": deleted, "skipped": skipped}
