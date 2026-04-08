"""Meeting Briefs service.

Filters the user's upcoming MS Graph calendar events down to qualifying client
meetings, binds each to a CRM Potential, and serves the get-or-create flow for
the meeting_brief agent insights.

Filter rule (deterministic, high-precision):
A meeting in the next 24h qualifies as a "client meeting" only if at least one is true:
  1. It's already linked to a Potential (CX_Meetings.PotentialId is set)
  2. An external attendee email matches a Contact in CRM
  3. An external attendee email domain matches an Account.website domain in CRM

When matched, we know which Account → pick the most relevant open Potential
on that account → bind the meeting to it.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlparse

from sqlalchemy import select

from core.database import get_session
from core.ms_graph import fetch_calendar_events, get_valid_ms_token
from core.models import Account, Contact, CXAgentInsight, CXMeeting, CXMeetingBriefDismissal, CXNote, CXSentEmail, CXTodo, Potential, User
from api.services.agent_service import (
    MEETING_BRIEF_AGENT_TYPE,
    fire_meeting_brief,
    get_meeting_brief_insight,
    is_meeting_brief_stale,
)

logger = logging.getLogger(__name__)

# Internal email domains — meetings with only internal attendees are dropped
INTERNAL_DOMAINS = {"flatworldsolutions.com", "flatworld.com.ph", "botworkflat.onmicrosoft.com"}

CLOSED_STAGES = {"Closed", "Closed Won", "Closed Lost", "Lost", "Disqualified"}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _parse_iso(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def _email_domain(email: str) -> str:
    if not email or "@" not in email:
        return ""
    return email.split("@", 1)[1].strip().lower()


def _normalize_website(website: str | None) -> str:
    """Pull the bare hostname out of a website URL string."""
    if not website:
        return ""
    w = website.strip().lower()
    if not w:
        return ""
    if "://" not in w:
        w = "http://" + w
    try:
        host = urlparse(w).hostname or ""
        if host.startswith("www."):
            host = host[4:]
        return host
    except Exception:
        return ""


def _is_internal_domain(domain: str) -> bool:
    return domain in INTERNAL_DOMAINS


_HTML_TAG_RE = re.compile(r"<[^>]+>")
_HTML_WS_RE = re.compile(r"\s+")


def _strip_html(html: str) -> str:
    """Quick HTML→plain-text. Good enough for meeting bodies; not a full parser."""
    if not html:
        return ""
    # Replace block-level breaks with newlines BEFORE stripping tags
    text = re.sub(r"</?(?:p|div|br|li|tr|h[1-6])[^>]*>", "\n", html, flags=re.IGNORECASE)
    text = _HTML_TAG_RE.sub("", text)
    # Decode common HTML entities
    text = (text
            .replace("&nbsp;", " ")
            .replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", '"')
            .replace("&#39;", "'"))
    # Collapse whitespace per line; keep newlines
    lines = [_HTML_WS_RE.sub(" ", ln).strip() for ln in text.splitlines()]
    cleaned = "\n".join([ln for ln in lines if ln])
    return cleaned.strip()


def _extract_agenda(event: dict) -> str:
    """Pull the meeting body/agenda as clean plain text. Falls back to bodyPreview."""
    body = event.get("body") or {}
    content = body.get("content") or ""
    content_type = (body.get("contentType") or "").lower()
    if content_type == "html":
        text = _strip_html(content)
    else:
        text = content.strip()
    if text:
        return text
    return (event.get("bodyPreview") or "").strip()


def _external_attendees(event: dict) -> list[dict]:
    """Return external attendees with at least an email."""
    out: list[dict] = []
    for a in event.get("attendees") or []:
        ea = (a.get("emailAddress") or {})
        addr = (ea.get("address") or "").strip().lower()
        if not addr:
            continue
        if _is_internal_domain(_email_domain(addr)):
            continue
        out.append({
            "email": addr,
            "name": ea.get("name") or None,
            "domain": _email_domain(addr),
        })
    return out


# ── Filtering + binding ──────────────────────────────────────────────────────

def _bind_meeting_to_potential(
    session, event: dict, externals: list[dict]
) -> tuple[Potential, Account | None, Contact | None] | None:
    """Try to find a CRM Potential for this meeting using the 3-rule filter.

    Returns (potential, account, contact) on match, or None if no binding."""
    ms_event_id = event.get("id", "")

    # Rule 1 — already linked in CX_Meetings
    cx_meeting = session.execute(
        select(CXMeeting).where(
            CXMeeting.ms_event_id == ms_event_id,
            CXMeeting.is_active == True,
            CXMeeting.potential_id.isnot(None),
        )
    ).scalar_one_or_none()
    if cx_meeting and cx_meeting.potential_id:
        row = session.execute(
            select(Potential, Account, Contact)
            .outerjoin(Account, Potential.account_id == Account.account_id)
            .outerjoin(Contact, Potential.contact_id == Contact.contact_id)
            .where(Potential.potential_id == cx_meeting.potential_id)
        ).first()
        if row:
            p, a, c = row
            return (p, a, c)

    if not externals:
        return None

    external_emails = [e["email"] for e in externals]
    external_domains = list({e["domain"] for e in externals if e["domain"]})

    # Rule 2 — external attendee email matches a Contact
    contact_match = session.execute(
        select(Contact, Account)
        .outerjoin(Account, Contact.account_id == Account.account_id)
        .where(Contact.email.in_(external_emails))
        .limit(1)
    ).first()
    if contact_match:
        c, a = contact_match
        # Pick the best Potential on this contact (or, fallback, on the account)
        pot_row = None
        if c.contact_id:
            pot_row = session.execute(
                select(Potential, Account)
                .outerjoin(Account, Potential.account_id == Account.account_id)
                .where(Potential.contact_id == c.contact_id)
                .order_by(Potential.modified_time.desc())
                .limit(1)
            ).first()
        if not pot_row and a:
            pot_row = session.execute(
                select(Potential, Account)
                .outerjoin(Account, Potential.account_id == Account.account_id)
                .where(Potential.account_id == a.account_id)
                .order_by(Potential.modified_time.desc())
                .limit(1)
            ).first()
        if pot_row:
            p, acc = pot_row
            return (p, acc, c)

    # Rule 3 — domain matches an Account.website
    if external_domains:
        accounts = session.execute(
            select(Account).where(Account.website.isnot(None))
        ).scalars().all()
        for acc in accounts:
            host = _normalize_website(acc.website)
            if not host:
                continue
            for d in external_domains:
                # exact or subdomain match
                if d == host or d.endswith("." + host) or host.endswith("." + d):
                    pot_row = session.execute(
                        select(Potential, Contact)
                        .outerjoin(Contact, Potential.contact_id == Contact.contact_id)
                        .where(Potential.account_id == acc.account_id)
                        .order_by(Potential.modified_time.desc())
                        .limit(1)
                    ).first()
                    if pot_row:
                        p, contact = pot_row
                        return (p, acc, contact)

    return None


# ── Dismissal persistence ────────────────────────────────────────────────────

DISMISSAL_STATUSES = {"done", "skipped"}


def get_dismissed_event_ids(user_id: str) -> set[str]:
    """Return the set of ms_event_ids the user has marked done/skipped."""
    with get_session() as session:
        rows = session.execute(
            select(CXMeetingBriefDismissal.ms_event_id).where(
                CXMeetingBriefDismissal.user_id == user_id,
                CXMeetingBriefDismissal.is_active == True,
            )
        ).scalars().all()
        return set(rows)


def resolve_meeting_brief(user_id: str, ms_event_id: str, status: str) -> bool:
    """Mark a meeting brief as done or skipped for a specific user.
    Upserts a row in CX_MeetingBriefDismissals."""
    if status not in DISMISSAL_STATUSES:
        return False
    now = datetime.now(timezone.utc)
    with get_session() as session:
        row = session.execute(
            select(CXMeetingBriefDismissal).where(
                CXMeetingBriefDismissal.user_id == user_id,
                CXMeetingBriefDismissal.ms_event_id == ms_event_id,
            )
        ).scalar_one_or_none()
        if row:
            row.status = status
            row.is_active = True
            row.updated_time = now
        else:
            session.add(CXMeetingBriefDismissal(
                user_id=user_id,
                ms_event_id=ms_event_id,
                status=status,
                created_time=now,
                updated_time=now,
                is_active=True,
            ))
    return True


# ── Find qualifying meetings ─────────────────────────────────────────────────

async def find_qualifying_meetings(user_id: str, hours_ahead: int = 24) -> list[dict[str, Any]]:
    """Pull MS Graph events for the next N hours and apply the filter+bind.

    Returns a list of dicts with: event, potential, account, contact, externals.
    """
    ms_token = await get_valid_ms_token(user_id)
    now = datetime.now(timezone.utc)
    end_dt = now + timedelta(hours=hours_ahead)
    raw_events = await fetch_calendar_events(ms_token, now, end_dt)
    logger.info(
        "[meeting_briefs] Fetched %d MS Graph events for user=%s in window %s..%s",
        len(raw_events), user_id, now.isoformat(), end_dt.isoformat(),
    )

    dismissed_ids = get_dismissed_event_ids(user_id)
    if dismissed_ids:
        logger.info("[meeting_briefs] %d meetings dismissed by this user", len(dismissed_ids))

    qualifying: list[dict[str, Any]] = []
    with get_session() as session:
        for event in raw_events:
            subject = event.get("subject", "(no subject)")
            event_id = event.get("id", "")
            start = (event.get("start") or {}).get("dateTime", "?")

            if event.get("isCancelled"):
                logger.info("[meeting_briefs] DROP cancelled: '%s' @ %s", subject, start)
                continue

            if event_id in dismissed_ids:
                logger.info("[meeting_briefs] DROP user-dismissed: '%s' @ %s", subject, start)
                continue

            externals = _external_attendees(event)
            if not externals:
                logger.info(
                    "[meeting_briefs] DROP no externals: '%s' @ %s (attendees=%s)",
                    subject, start,
                    [(a.get("emailAddress") or {}).get("address", "?") for a in (event.get("attendees") or [])],
                )
                continue

            binding = _bind_meeting_to_potential(session, event, externals)
            if not binding:
                logger.info(
                    "[meeting_briefs] DROP no CRM match: '%s' @ %s — externals=%s, no contact email match, no account.website domain match",
                    subject, start, [e["email"] for e in externals],
                )
                continue

            potential, account, contact = binding
            logger.info(
                "[meeting_briefs] KEEP '%s' @ %s → potential=#%s '%s' (account=%s, contact=%s)",
                subject, start,
                potential.potential_number, potential.potential_name,
                account.account_name if account else "—",
                contact.full_name if contact else "—",
            )
            qualifying.append({
                "event": event,
                "potential": potential,
                "account": account,
                "contact": contact,
                "externals": externals,
            })

    logger.info(
        "[meeting_briefs] Filter result: %d qualifying / %d total events",
        len(qualifying), len(raw_events),
    )
    # Sort by start time ascending
    qualifying.sort(key=lambda q: _parse_iso((q["event"].get("start") or {}).get("dateTime")) or now)
    return qualifying


# ── Skeleton (instant Layer A) ───────────────────────────────────────────────

def build_skeleton(item: dict[str, Any]) -> dict[str, Any]:
    """Build the instant skeleton from DB lookups — no agent involved."""
    event = item["event"]
    p: Potential = item["potential"]
    a: Account | None = item["account"]
    c: Contact | None = item["contact"]
    externals = item["externals"]

    start = (event.get("start") or {}).get("dateTime")
    end = (event.get("end") or {}).get("dateTime")

    # Last activity / counts (cheap rollups)
    with get_session() as session:
        notes_count = session.execute(
            select(CXNote).where(CXNote.potential_id == p.potential_id, CXNote.is_active == True)
        ).all()
        open_todos_count = session.execute(
            select(CXTodo).where(
                CXTodo.potential_id == p.potential_id,
                CXTodo.is_active == True,
                CXTodo.is_completed == False,
            )
        ).all()
        recent_emails_count = session.execute(
            select(CXSentEmail).where(
                CXSentEmail.potential_id == p.potential_id,
                CXSentEmail.is_active == True,
                CXSentEmail.sent_time >= datetime.now(timezone.utc) - timedelta(days=7),
            )
        ).all()

    return {
        "ms_event_id": event.get("id"),
        "meeting_title": event.get("subject"),
        "meeting_start": start,
        "meeting_end": end,
        "is_online": event.get("isOnlineMeeting", False),
        "attendees": externals,
        "potential": {
            "potential_id": p.potential_id,
            "potential_number": p.potential_number,
            "name": p.potential_name,
            "stage": p.stage,
            "amount": float(p.amount) if p.amount is not None else None,
            "probability": float(p.probability) if p.probability is not None else None,
            "closing_date": p.closing_date.date().isoformat() if p.closing_date else None,
            "owner": p.potential_owner_name,
        },
        "account": {
            "account_id": a.account_id if a else None,
            "name": a.account_name if a else None,
            "industry": a.industry if a else None,
            "website": a.website if a else None,
        } if a else None,
        "contact": {
            "contact_id": c.contact_id if c else None,
            "name": c.full_name if c else None,
            "title": c.title if c else None,
            "email": c.email if c else None,
        } if c else None,
        "rollups": {
            "notes_count": len(notes_count),
            "open_todos_count": len(open_todos_count),
            "recent_emails_7d": len(recent_emails_count),
        },
    }


# ── Public: get_or_create briefs for upcoming meetings ───────────────────────

async def get_upcoming_briefs(user_id: str, hours_ahead: int = 24) -> list[dict[str, Any]]:
    """Main entry point for the dashboard.

    For each qualifying meeting in the next 24h:
      1. Build the instant skeleton
      2. Look up cached meeting_brief insight
      3. If missing or stale, fire a fresh trigger
      4. Return [{ skeleton, brief: { status, content, error } }, ...]
    """
    qualifying = await find_qualifying_meetings(user_id, hours_ahead=hours_ahead)
    out: list[dict[str, Any]] = []

    for item in qualifying:
        event = item["event"]
        potential: Potential = item["potential"]
        ms_event_id = event.get("id")

        skeleton = build_skeleton(item)

        existing = get_meeting_brief_insight(potential.potential_id, ms_event_id)
        needs_fire = False
        if not existing:
            needs_fire = True
        elif existing.status == "error":
            needs_fire = True
        elif existing.status == "completed" and is_meeting_brief_stale(existing):
            needs_fire = True
        # If pending/running, leave alone — let it finish

        if needs_fire:
            existing = fire_meeting_brief(
                potential_id=potential.potential_id,
                ms_event_id=ms_event_id,
                meeting_info={
                    "ms_event_id": ms_event_id,
                    "title": event.get("subject", ""),
                    "start": (event.get("start") or {}).get("dateTime", ""),
                    "end": (event.get("end") or {}).get("dateTime", ""),
                    "is_online": event.get("isOnlineMeeting", False),
                    "location": (event.get("location") or {}).get("displayName") or None,
                    "organizer": ((event.get("organizer") or {}).get("emailAddress") or {}).get("address") or None,
                    "attendees": item["externals"],
                    "agenda": _extract_agenda(event),
                },
            )

        brief = {
            "status": existing.status if existing else "pending",
            "content": existing.content if existing else None,
            "content_type": existing.content_type if existing else "markdown",
            "error_message": existing.error_message if existing else None,
            "completed_at": existing.completed_time.isoformat() if existing and existing.completed_time else None,
        }

        out.append({
            "skeleton": skeleton,
            "brief": brief,
        })

    return out
