"""Global chat service — cross-entity AI chat with tool use.

Architecture:
  - Uses Anthropic's tool use (function calling) feature
  - Multi-turn loop: model -> tool_use -> we execute via crm_query_tools -> tool_result -> model continues
  - Streams text deltas to the frontend as SSE
  - Emits 'tool' events so the UI can show "Looking up potentials…" indicators
  - History is organized into named conversations per user (multi-thread)
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any, Iterator

import anthropic
from sqlalchemy import func, select

import core.config as config
from core.database import get_session
from core.models import CXGlobalChatConversation, CXGlobalChatMessage, User
from core.schemas import ChatMessageItem
from api.services.crm_query_tools import TOOL_FUNCTIONS, TOOL_SCHEMAS

logger = logging.getLogger(__name__)


# ── Conversation persistence ─────────────────────────────────────────────────

def list_conversations(user_id: str) -> list[dict[str, Any]]:
    """All conversations for a user, ordered by last activity (most recent first)."""
    with get_session() as session:
        # Per-conversation message count + last message time
        msg_stats = (
            select(
                CXGlobalChatMessage.conversation_id.label("cid"),
                func.count(CXGlobalChatMessage.id).label("count"),
                func.max(CXGlobalChatMessage.created_time).label("last_time"),
            )
            .where(CXGlobalChatMessage.is_active == True)
            .group_by(CXGlobalChatMessage.conversation_id)
            .subquery()
        )

        stmt = (
            select(CXGlobalChatConversation, msg_stats.c.count, msg_stats.c.last_time)
            .outerjoin(msg_stats, msg_stats.c.cid == CXGlobalChatConversation.id)
            .where(
                CXGlobalChatConversation.user_id == user_id,
                CXGlobalChatConversation.is_active == True,
            )
            .order_by(CXGlobalChatConversation.updated_time.desc())
        )
        rows = session.execute(stmt).all()
        return [
            {
                "id": c.id,
                "title": c.title,
                "created_time": c.created_time,
                "updated_time": c.updated_time,
                "message_count": int(count or 0),
                "last_message_time": last_time,
            }
            for c, count, last_time in rows
        ]


def create_conversation(user_id: str) -> dict[str, Any]:
    """Create a new empty conversation. Returns its row as dict."""
    now = datetime.now(timezone.utc)
    with get_session() as session:
        conv = CXGlobalChatConversation(
            user_id=user_id,
            title=None,
            created_time=now,
            updated_time=now,
            is_active=True,
        )
        session.add(conv)
        session.flush()
        session.refresh(conv)
        return {
            "id": conv.id,
            "title": conv.title,
            "created_time": conv.created_time,
            "updated_time": conv.updated_time,
            "message_count": 0,
            "last_message_time": None,
        }


def delete_conversation(user_id: str, conversation_id: int) -> bool:
    now = datetime.now(timezone.utc)
    with get_session() as session:
        conv = session.execute(
            select(CXGlobalChatConversation).where(
                CXGlobalChatConversation.id == conversation_id,
                CXGlobalChatConversation.user_id == user_id,
                CXGlobalChatConversation.is_active == True,
            )
        ).scalar_one_or_none()
        if not conv:
            return False
        conv.is_active = False
        conv.updated_time = now
        # Soft-delete all its messages
        msgs = session.execute(
            select(CXGlobalChatMessage).where(
                CXGlobalChatMessage.conversation_id == conversation_id,
                CXGlobalChatMessage.is_active == True,
            )
        ).scalars().all()
        for m in msgs:
            m.is_active = False
            m.updated_time = now
        return True


def rename_conversation(user_id: str, conversation_id: int, title: str) -> bool:
    now = datetime.now(timezone.utc)
    with get_session() as session:
        conv = session.execute(
            select(CXGlobalChatConversation).where(
                CXGlobalChatConversation.id == conversation_id,
                CXGlobalChatConversation.user_id == user_id,
                CXGlobalChatConversation.is_active == True,
            )
        ).scalar_one_or_none()
        if not conv:
            return False
        conv.title = title.strip()[:256]
        conv.updated_time = now
        return True


def _touch_conversation(session, conversation_id: int) -> None:
    """Bump the conversation's updated_time so it surfaces to the top of the list."""
    conv = session.get(CXGlobalChatConversation, conversation_id)
    if conv and conv.is_active:
        conv.updated_time = datetime.now(timezone.utc)


# ── Message persistence ───────────────────────────────────────────────────────

def list_conversation_messages(user_id: str, conversation_id: int, limit: int = 500) -> list[ChatMessageItem]:
    """All messages within a single conversation, ordered chronologically."""
    with get_session() as session:
        # Verify ownership
        conv = session.execute(
            select(CXGlobalChatConversation).where(
                CXGlobalChatConversation.id == conversation_id,
                CXGlobalChatConversation.user_id == user_id,
                CXGlobalChatConversation.is_active == True,
            )
        ).scalar_one_or_none()
        if not conv:
            return []
        stmt = (
            select(CXGlobalChatMessage)
            .where(
                CXGlobalChatMessage.conversation_id == conversation_id,
                CXGlobalChatMessage.is_active == True,
            )
            .order_by(CXGlobalChatMessage.created_time.asc())
            .limit(limit)
        )
        return [
            ChatMessageItem(id=m.id, role=m.role, content=m.content, created_time=m.created_time)
            for m in session.execute(stmt).scalars().all()
        ]


# ── Title generation ─────────────────────────────────────────────────────────

def _generate_title(user_message: str, assistant_response: str) -> str | None:
    """One-shot Claude call to summarise this conversation as a 3-6 word title."""
    try:
        client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY)
        prompt = (
            "Generate a very short title (3-6 words, no punctuation, title case) that summarises "
            "this CRM chat exchange. Return only the title, nothing else.\n\n"
            f"User: {user_message[:500]}\n\nAssistant: {assistant_response[:1500]}"
        )
        response = client.messages.create(
            model=config.ANTHROPIC_MODEL,
            max_tokens=40,
            messages=[{"role": "user", "content": prompt}],
        )
        title = response.content[0].text.strip().strip('"').strip("'")
        # Trim trailing punctuation and limit length
        title = title.rstrip(".!?").strip()
        return title[:80] if title else None
    except Exception as e:
        logger.warning("Title generation failed: %s", e)
        return None


# ── System prompt ────────────────────────────────────────────────────────────

def _build_system_prompt(user: User) -> str:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return f"""You are Salezilla AI — a sales analyst assistant embedded in an AI-powered CRM for Flatworld Solutions.

You help the salesperson get insights across their entire pipeline: potentials, accounts (companies), and contacts.

# Current user
- Name: {user.name}
- Email: {user.email}
- User ID: {user.user_id}
- Today's date: {today}

# How to answer questions
1. **Always use tools to get data.** Never invent numbers, names, stages, or dates. If a tool returns no data, say so honestly.
2. **Be concise and lead with the answer.** Then offer relevant detail.
3. **Use "me/my/mine" → filter by current user.** When the user says "my potentials", "my pipeline", "owned by me", pass `owner_name_like="{user.name}"` to the relevant tool.
4. **Reference real records** in your answer — use potential numbers (e.g. `#1234567`), account names, contact names. This makes them clickable in the UI.
5. **Resolve ambiguity** — if a lookup returns `ambiguous: true`, present the matches as a numbered list and ask the user to pick one. Don't guess.
6. **Compose multiple tool calls** when a question needs different data. For example, "How is my Healthcare pipeline doing?" → call `pipeline_summary(group_by="stage", services=["Healthcare"], owner_name_like="{user.name}")` AND `revenue_summary(period="current_quarter", services=["Healthcare"], owner_name_like="{user.name}")`.
7. **Format with markdown** — use tables for comparative data, bullet lists for enumerations, bold for key numbers.

# CRITICAL: Tool result interpretation
**Trust is everything. A wrong answer is worse than no answer. Read tool results carefully.**

1. **`search_*` tools are PAGINATED.** They return at most ~50 rows even if the true count is in the thousands. Every search result has TWO numbers:
   - `total` = the actual count of matching records in the database
   - `returned` = how many rows are in `items` (capped at the limit)
   - **NEVER assume `returned` is the full universe.** If `total > returned`, the `items` list is just a sample.
   - Always state the true `total` to the user (e.g. "Found 487 matching accounts. Showing the first 50…").
   - If the user's question requires looking at ALL of them (ranking, distribution, "which has the most", "what fraction"), DO NOT try to derive the answer from a sample of 50. Instead use an aggregation tool.

2. **Pick the right tool family for the question:**
   - **"List me…", "Show me a few…", "Find…"** → `search_*` tools (paginated, OK for samples)
   - **"How many…", "What's the total…", "Distribution by…", "Breakdown of…", "Which has the most…", "Top N by count/value", "Average…"** → `pipeline_summary`, `revenue_summary`, or `time_based_query`. These aggregate ALL matching records server-side, no row cap. Use them whenever the question needs a full-population answer.
   - **"Tell me about [specific potential/account/contact]"** → `get_*_details` or `get_*_full_context` (single-entity lookups)

3. **Never extrapolate from a sample.** If you have 50 of 487 accounts and the user asks "which account has the most open potentials?", the right answer is NOT "based on what I see, X has the most" — it's *"I can't answer that from a paginated sample. Let me use the aggregation tool instead."* Then call the aggregation tool.

4. **If a needed aggregation tool doesn't exist**, say so honestly: *"I can list a sample of accounts but I don't have a tool that ranks all 487 of them by open potential count. Want me to show you the top 50 sorted by [some available proxy]?"* — don't fake the answer.

# Conversation continuity
The user often asks follow-up questions about the same subset of records you just discussed. When the new question references the same universe (e.g. you just listed open potentials, then they ask "break those down by stage"):
- Apply the SAME filters from the previous turn (services, owner, country, stage filters, etc.) so the numbers stay consistent.
- Briefly reference the connection: *"Of the 487 open potentials we just looked at, here's the stage breakdown…"*
- If your tool returns a different total than the previous turn implied, **explain the discrepancy** rather than ignoring it.

# Ambiguous questions — show overview, then ask
If the user's question is ambiguous (vague terms, multiple valid interpretations, missing time window, missing scope), DON'T pick one interpretation silently and answer it. Instead:

1. Pull a **broad overview** that covers the most likely interpretations.
2. Present the breakdown.
3. Ask which dimension they want to dive into.

**Examples of ambiguous terms:** "action", "activity", "touched", "worked on", "stuck", "doing well", "behind", "recent", "old", "hot", "important", "stale", "good potentials", "big potentials", a vague time reference like "lately" or "recently".

**Worked example — user asks: "Get me potentials where sales guys took action in last 24 hours"**
"Action" is ambiguous — it could mean field edits, notes, todos, emails sent, stage changes, etc. Don't guess. Instead:
1. Call `recent_activity(hours=24)` to get the broad picture
2. Present the per-category breakdown:
   > In the last 24 hours, the team logged **47 actions** across **18 potentials**:
   > - 📝 18 notes added
   > - ✅ 12 todos created/updated
   > - 📧 9 emails sent
   > - 🔄 5 stage changes
   > - ✏️ 3 field edits
3. Ask: *"Which category would you like to dive into? Or want me to show the top potentials by total activity?"*

**Worked example — user asks: "Show me my hot potentials"**
"Hot" could mean the Platinum/Diamond flag, high probability, high value, recent activity, or closing soon. Show 2-3 lenses (e.g. flagged + high probability + high value), then ask which lens matches their intent.

**Don't ask for clarification on every question** — only when the answer would meaningfully change based on interpretation. If the question is clear, just answer it directly.

# Picking the right potential lookup tool
- **`get_potential_details`** — basic facts only (stage, amount, owner, dates). Use for quick lookups: "what stage is X in", "what's the amount of Y".
- **`get_potential_full_context`** — DEEP context (all notes, todos, emails, AI insights). **Always use this** when the user wants to:
  - Draft an email or reply about the potential
  - Decide what the next step should be
  - Summarise the potential history or recent activity
  - Understand risks, blockers, or what's been discussed
  - Reference notes, emails, or AI research/solution agent output
  - Answer "what do I know about [potential]?" / "tell me about [potential]"
  - Any question that needs judgement, not just facts
  Load the full context BEFORE composing your answer — don't try to answer from memory or partial data.

# Available tools
You have 10 tools covering: filtered listings, single-entity lookups, cross-entity 360 views, and aggregate analytics. Pick the most specific tool for the question.

# UI navigation vs analytical scope (IMPORTANT)
The CRM applies an ownership rule:
- **Aggregate / analytical questions** (totals, breakdowns, "how many", "average", revenue summaries) — you SEE all-org data via the tools and should answer them honestly across the whole pipeline. Always do this when the user asks for org-wide insights.
- **UI navigation** — the user can ONLY click into / open potentials, accounts and contacts they personally OWN. If you mention a specific record by number/name in your answer, the user might try to click it. So:
  - When suggesting specific potentials/accounts/contacts to drill into ("you should look at #1234567"), prefer ones owned by `{user.name}` since others are not openable in the UI.
  - When listing rows for a "show me" question scoped to "my/me/mine", filter by `owner_name_like="{user.name}"`.
  - When the user asks an org-wide question and you list specific records (e.g. "the 5 biggest potentials in the org"), you MAY include records owned by others — but flag them: *"(owned by Jane Doe — view-only via this chat)"* so the user knows clicking won't work.
- Never refuse to compute aggregates that include other people's data — the user is allowed to see totals.

# Honesty about gaps
Some fields the user might ask about are not tracked in this CRM yet:
- Stage history / how long in current stage (we only have last-modified time, which is a proxy)
- Lost reasons, prediction scores, visitor scores, web visit history
- Territories, business units, UTM campaign data
- Lead website URL, referrer, keywords
If asked, explain politely that the data isn't tracked and offer the closest available metric.

# Style
- Brief. Lead with the answer. Bullet lists over paragraphs.
- Always include actual numbers and names from tool results.
- If there are too many results to list, summarise + show the top 5.
- For aggregations, format money as `$1.2M`, `$245K`, etc.

# Follow-up suggestions (REQUIRED)
After every answer, you MUST append a `<followups>` block containing a JSON array of exactly 3 short, contextually-relevant follow-up questions the user is likely to ask next based on the data you just showed them. Make them specific (reference real entities/numbers from your answer when possible), actionable, and varied (don't just rephrase the same question).

Format (this MUST be the very last thing in your response, with no text after it):
<followups>["Question 1?", "Question 2?", "Question 3?"]</followups>

Example — if you just listed 5 potentials closing this week, follow-ups might be:
<followups>["Which of these has the highest probability of closing?", "Show me the next steps for the top 3", "What's the total value of these 5 potentials?"]</followups>

Do NOT mention the follow-ups block in your prose — just append it silently at the end. Do NOT skip it.
"""


# ── Streaming + multi-turn tool dispatch ─────────────────────────────────────

def stream_global_chat(
    user: User,
    conversation_id: int,
    user_message: str,
    history: list[ChatMessageItem],
) -> Iterator[str]:
    """Run a global chat turn with multi-turn tool use, yielding SSE chunks."""

    # Verify conversation belongs to user
    with get_session() as session:
        conv = session.execute(
            select(CXGlobalChatConversation).where(
                CXGlobalChatConversation.id == conversation_id,
                CXGlobalChatConversation.user_id == user.user_id,
                CXGlobalChatConversation.is_active == True,
            )
        ).scalar_one_or_none()
        if not conv:
            yield f"data: {json.dumps({'type': 'error', 'message': 'Conversation not found'})}\n\n"
            return
        needs_title = conv.title is None

    # Save user message
    now = datetime.now(timezone.utc)
    with get_session() as session:
        session.add(CXGlobalChatMessage(
            user_id=user.user_id,
            conversation_id=conversation_id,
            role="user", content=user_message,
            created_time=now, updated_time=now, is_active=True,
        ))
        _touch_conversation(session, conversation_id)
        session.flush()

    system_prompt = _build_system_prompt(user)

    # Drop trailing dangling user messages from history
    trimmed_history = list(history)
    while trimmed_history and trimmed_history[-1].role == "user":
        trimmed_history.pop()
    messages: list[dict] = [{"role": m.role, "content": m.content} for m in trimmed_history]
    messages.append({"role": "user", "content": user_message})

    client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY)

    full_text_response = ""
    max_turns = 8  # safety cap on tool-use loops

    try:
        for turn in range(max_turns):
            assistant_blocks: list[dict] = []
            current_text = ""
            current_tool_use: dict | None = None
            current_tool_input_buffer = ""
            tool_uses_in_turn: list[dict] = []

            with client.messages.stream(
                model=config.ANTHROPIC_MODEL,
                max_tokens=4096,
                system=system_prompt,
                messages=messages,
                tools=TOOL_SCHEMAS,
            ) as stream:
                for event in stream:
                    etype = getattr(event, "type", None)

                    if etype == "content_block_start":
                        block = getattr(event, "content_block", None)
                        if block and getattr(block, "type", None) == "tool_use":
                            current_tool_use = {
                                "type": "tool_use",
                                "id": block.id,
                                "name": block.name,
                                "input": {},
                            }
                            current_tool_input_buffer = ""
                            yield f"data: {json.dumps({'type': 'tool', 'name': block.name, 'status': 'running'})}\n\n"
                        elif block and getattr(block, "type", None) == "text":
                            current_text = ""

                    elif etype == "content_block_delta":
                        delta = getattr(event, "delta", None)
                        if delta:
                            dtype = getattr(delta, "type", None)
                            if dtype == "text_delta":
                                text = delta.text
                                current_text += text
                                full_text_response += text
                                yield f"data: {json.dumps({'type': 'text', 'content': text})}\n\n"
                            elif dtype == "input_json_delta":
                                current_tool_input_buffer += delta.partial_json

                    elif etype == "content_block_stop":
                        if current_tool_use is not None:
                            try:
                                current_tool_use["input"] = json.loads(current_tool_input_buffer or "{}")
                            except json.JSONDecodeError:
                                current_tool_use["input"] = {}
                            assistant_blocks.append(current_tool_use)
                            tool_uses_in_turn.append(current_tool_use)
                            current_tool_use = None
                            current_tool_input_buffer = ""
                        elif current_text:
                            assistant_blocks.append({"type": "text", "text": current_text})
                            current_text = ""

                # End of stream

            # If no tool uses this turn, we're done
            if not tool_uses_in_turn:
                break

            # Append assistant message and execute each tool
            messages.append({"role": "assistant", "content": assistant_blocks})

            tool_result_blocks: list[dict] = []
            for tool_use in tool_uses_in_turn:
                tool_name = tool_use["name"]
                tool_input = tool_use["input"]
                logger.info("Global chat tool call: %s(%s)", tool_name, tool_input)
                try:
                    fn = TOOL_FUNCTIONS.get(tool_name)
                    if not fn:
                        result = {"error": f"Unknown tool {tool_name}"}
                    else:
                        result = fn(**tool_input)
                except Exception as e:
                    logger.exception("Tool %s failed: %s", tool_name, e)
                    result = {"error": str(e)}

                tool_result_blocks.append({
                    "type": "tool_result",
                    "tool_use_id": tool_use["id"],
                    "content": json.dumps(result, default=str),
                })

            messages.append({"role": "user", "content": tool_result_blocks})
            # Loop again — Claude will continue with these tool results

        # Save assistant response
        if full_text_response.strip():
            now2 = datetime.now(timezone.utc)
            with get_session() as session:
                msg = CXGlobalChatMessage(
                    user_id=user.user_id,
                    conversation_id=conversation_id,
                    role="assistant", content=full_text_response,
                    created_time=now2, updated_time=now2, is_active=True,
                )
                session.add(msg)
                _touch_conversation(session, conversation_id)
                session.flush()
                session.refresh(msg)
                yield f"data: {json.dumps({'type': 'done', 'message_id': msg.id})}\n\n"

            # Auto-generate title for first response in this conversation
            if needs_title:
                title = _generate_title(user_message, full_text_response)
                if title:
                    with get_session() as session:
                        conv = session.get(CXGlobalChatConversation, conversation_id)
                        if conv and conv.is_active and conv.title is None:
                            conv.title = title
                            conv.updated_time = datetime.now(timezone.utc)
                    yield f"data: {json.dumps({'type': 'title', 'title': title})}\n\n"
        else:
            yield f"data: {json.dumps({'type': 'done', 'message_id': None})}\n\n"

    except Exception as e:
        logger.exception("Global chat streaming error: %s", e)
        error_msg = "Sorry, I encountered an error. Please try again."
        now3 = datetime.now(timezone.utc)
        with get_session() as session:
            session.add(CXGlobalChatMessage(
                user_id=user.user_id,
                conversation_id=conversation_id,
                role="assistant", content=error_msg,
                created_time=now3, updated_time=now3, is_active=True,
            ))
            _touch_conversation(session, conversation_id)
            session.flush()
        yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
