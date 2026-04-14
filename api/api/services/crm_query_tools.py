"""CRM query tools — typed read-only functions exposed to the global chat agent.

Each function returns plain dicts/lists ready to JSON-serialise back to Claude
as a `tool_result`. Designed to cover the question categories in
`chat_sample_questions.txt`. Tools are deliberately strict about parameters
(no free-form SQL, no joins outside what's explicitly composed here).

Field availability is bounded by what's actually in the schema today —
many wishlist fields (stage history, UTM, visitor scores, lost reasons,
territories, BUs) don't exist yet and the tools will return `not_available`
markers in their place so Claude can be honest with the user.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import and_, func, or_, select

from core.database import get_session
from core.models import (
    Account, Contact, CXActivity, CXNote, CXSentEmail, CXTodo,
    Potential, User,
)

logger = logging.getLogger(__name__)

# ── Helpers ───────────────────────────────────────────────────────────────────

MAX_LIMIT = 50  # cap on rows returned per call


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _serialise_potential(p: Potential, a: Account | None = None, c: Contact | None = None) -> dict[str, Any]:
    return {
        "potential_number": p.potential_number,
        "name": p.potential_name,
        "stage": p.stage,
        "amount": float(p.amount) if p.amount is not None else None,
        "probability": float(p.probability) if p.probability is not None else None,
        "service": p.service,
        "sub_service": p.sub_service,
        "type": p.type,
        "deal_size": p.deal_size,
        "lead_source": p.lead_source,
        "next_step": p.next_step,
        "closing_date": p.closing_date.date().isoformat() if p.closing_date else None,
        "owner": p.potential_owner_name,
        "is_diamond": p.potential2close == 1,
        "is_platinum": (p.hot_potential or "").lower() == "true",
        "account_name": a.account_name if a else None,
        "contact_name": c.full_name if c else None,
        "contact_email": c.email if c else None,
        "created": p.created_time.date().isoformat() if p.created_time else None,
        "modified": p.modified_time.date().isoformat() if p.modified_time else None,
    }


def _serialise_account(a: Account) -> dict[str, Any]:
    return {
        "account_id": a.account_id,
        "account_name": a.account_name,
        "industry": a.industry,
        "website": a.website,
        "employees": a.employees,
        "annual_revenue": float(a.annual_revenue) if a.annual_revenue is not None else None,
        "phone": a.phone,
        "billing_city": a.billing_city,
        "billing_state": a.billing_state,
        "billing_country": a.billing_country or a.country_fws,
        "rating": a.rating,
        "account_type": a.account_type,
        "created": a.created_time.date().isoformat() if a.created_time else None,
    }


def _serialise_contact(c: Contact, a: Account | None = None) -> dict[str, Any]:
    return {
        "contact_id": c.contact_id,
        "full_name": c.full_name,
        "title": c.title,
        "email": c.email,
        "phone": c.phone,
        "mobile": c.mobile,
        "department": c.department,
        "lead_source": c.lead_source,
        "account_id": c.account_id,
        "account_name": a.account_name if a else None,
    }


# ── Tool 1: search_potentials ────────────────────────────────────────────────

def search_potentials(
    stages: list[str] | None = None,
    services: list[str] | None = None,
    owner_name_like: str | None = None,
    country: str | None = None,
    account_name_like: str | None = None,
    min_amount: float | None = None,
    max_amount: float | None = None,
    closing_after: str | None = None,   # ISO date
    closing_before: str | None = None,  # ISO date
    created_after: str | None = None,   # ISO date
    has_next_step: bool | None = None,
    is_diamond: bool | None = None,
    is_platinum: bool | None = None,
    type: str | None = None,
    deal_size: str | None = None,
    sort_by: str = "modified_desc",
    limit: int = 25,
) -> dict[str, Any]:
    """Filter potentials. Returns up to `limit` results plus a total count."""
    limit = min(limit or 25, MAX_LIMIT)

    with get_session() as session:
        stmt = (
            select(Potential, Account, Contact)
            .outerjoin(Account, Potential.account_id == Account.account_id)
            .outerjoin(Contact, Potential.contact_id == Contact.contact_id)
        )

        if stages:
            stmt = stmt.where(Potential.stage.in_(stages))
        if services:
            stmt = stmt.where(Potential.service.in_(services))
        if owner_name_like:
            stmt = stmt.where(Potential.potential_owner_name.ilike(f"%{owner_name_like}%"))
        if country:
            stmt = stmt.where(or_(
                Account.billing_country.ilike(f"%{country}%"),
                Account.country_fws.ilike(f"%{country}%"),
            ))
        if account_name_like:
            stmt = stmt.where(Account.account_name.ilike(f"%{account_name_like}%"))
        if min_amount is not None:
            stmt = stmt.where(Potential.amount >= min_amount)
        if max_amount is not None:
            stmt = stmt.where(Potential.amount <= max_amount)
        if closing_after:
            stmt = stmt.where(Potential.closing_date >= datetime.fromisoformat(closing_after))
        if closing_before:
            stmt = stmt.where(Potential.closing_date <= datetime.fromisoformat(closing_before))
        if created_after:
            stmt = stmt.where(Potential.created_time >= datetime.fromisoformat(created_after))
        if has_next_step is True:
            stmt = stmt.where(and_(Potential.next_step.isnot(None), Potential.next_step != ""))
        if has_next_step is False:
            stmt = stmt.where(or_(Potential.next_step.is_(None), Potential.next_step == ""))
        if is_diamond is True:
            stmt = stmt.where(Potential.potential2close == 1)
        if is_platinum is True:
            stmt = stmt.where(func.lower(Potential.hot_potential) == "true")
        if type:
            stmt = stmt.where(Potential.type == type)
        if deal_size:
            stmt = stmt.where(Potential.deal_size == deal_size)

        # Total count
        count_stmt = select(func.count()).select_from(stmt.subquery())
        total = session.execute(count_stmt).scalar() or 0

        # Sort
        if sort_by == "amount_desc":
            stmt = stmt.order_by(Potential.amount.desc())
        elif sort_by == "amount_asc":
            stmt = stmt.order_by(Potential.amount.asc())
        elif sort_by == "closing_asc":
            stmt = stmt.order_by(Potential.closing_date.asc())
        elif sort_by == "created_desc":
            stmt = stmt.order_by(Potential.created_time.desc())
        else:  # modified_desc
            stmt = stmt.order_by(Potential.modified_time.desc())

        rows = session.execute(stmt.limit(limit)).all()
        items = [_serialise_potential(p, a, c) for p, a, c in rows]

    return {"total": total, "returned": len(items), "items": items}


# ── Tool 2: get_potential_details ────────────────────────────────────────────

def get_potential_details(potential_number_or_name: str) -> dict[str, Any]:
    """Look up a single potential by 7-digit number or by name (fuzzy match)."""
    with get_session() as session:
        # Try exact potential_number first
        stmt = (
            select(Potential, Account, Contact)
            .outerjoin(Account, Potential.account_id == Account.account_id)
            .outerjoin(Contact, Potential.contact_id == Contact.contact_id)
            .where(Potential.potential_number == potential_number_or_name)
        )
        row = session.execute(stmt).first()

        if not row:
            # Fuzzy by name
            stmt = (
                select(Potential, Account, Contact)
                .outerjoin(Account, Potential.account_id == Account.account_id)
                .outerjoin(Contact, Potential.contact_id == Contact.contact_id)
                .where(Potential.potential_name.ilike(f"%{potential_number_or_name}%"))
                .order_by(Potential.modified_time.desc())
                .limit(5)
            )
            rows = session.execute(stmt).all()
            if not rows:
                return {"error": "not_found", "query": potential_number_or_name}
            if len(rows) > 1:
                return {
                    "ambiguous": True,
                    "matches": [_serialise_potential(p, a, c) for p, a, c in rows],
                }
            row = rows[0]

        p, a, c = row
        result = _serialise_potential(p, a, c)
        result["description"] = p.description

        # Last activity
        last_act = session.execute(
            select(CXActivity)
            .where(CXActivity.potential_id == p.potential_id, CXActivity.is_active == True)
            .order_by(CXActivity.created_time.desc())
            .limit(1)
        ).scalar_one_or_none()
        if last_act:
            result["last_activity"] = {
                "type": last_act.activity_type,
                "description": last_act.description,
                "when": last_act.created_time.isoformat() if last_act.created_time else None,
            }

        # Notes count + most recent
        notes_count = session.execute(
            select(func.count()).select_from(CXNote)
            .where(CXNote.potential_id == p.potential_id, CXNote.is_active == True)
        ).scalar() or 0
        result["notes_count"] = notes_count

        # Open todos
        open_todos = session.execute(
            select(CXTodo).where(
                CXTodo.potential_id == p.potential_id,
                CXTodo.is_active == True,
                CXTodo.is_completed == False,
            ).order_by(CXTodo.created_time.desc()).limit(10)
        ).scalars().all()
        result["open_todos"] = [{"text": t.text, "status": t.status} for t in open_todos]

        return result


# ── Tool 3: search_accounts ──────────────────────────────────────────────────

def search_accounts(
    industry: str | None = None,
    country: str | None = None,
    account_name_like: str | None = None,
    has_open_potentials: bool | None = None,
    rating: str | None = None,
    min_revenue: float | None = None,
    sort_by: str = "name_asc",
    limit: int = 25,
) -> dict[str, Any]:
    """Filter accounts."""
    limit = min(limit or 25, MAX_LIMIT)

    with get_session() as session:
        stmt = select(Account)

        if industry:
            stmt = stmt.where(Account.industry.ilike(f"%{industry}%"))
        if country:
            stmt = stmt.where(or_(
                Account.billing_country.ilike(f"%{country}%"),
                Account.country_fws.ilike(f"%{country}%"),
            ))
        if account_name_like:
            stmt = stmt.where(Account.account_name.ilike(f"%{account_name_like}%"))
        if rating:
            stmt = stmt.where(Account.rating == rating)
        if min_revenue is not None:
            stmt = stmt.where(Account.annual_revenue >= min_revenue)

        if has_open_potentials is True:
            open_account_ids = select(Potential.account_id).where(
                Potential.stage.notin_(["Closed", "Closed Won", "Closed Lost", "Lost", "Disqualified"])
            ).distinct()
            stmt = stmt.where(Account.account_id.in_(open_account_ids))
        elif has_open_potentials is False:
            potential_account_ids = select(Potential.account_id).distinct()
            stmt = stmt.where(Account.account_id.notin_(potential_account_ids))

        count_stmt = select(func.count()).select_from(stmt.subquery())
        total = session.execute(count_stmt).scalar() or 0

        if sort_by == "revenue_desc":
            stmt = stmt.order_by(Account.annual_revenue.desc())
        elif sort_by == "created_desc":
            stmt = stmt.order_by(Account.created_time.desc())
        else:
            stmt = stmt.order_by(Account.account_name.asc())

        accounts = session.execute(stmt.limit(limit)).scalars().all()
        items = [_serialise_account(a) for a in accounts]

    return {"total": total, "returned": len(items), "items": items}


# ── Tool 4: get_account_360 ──────────────────────────────────────────────────

def get_account_360(account_name_or_id: str) -> dict[str, Any]:
    """Full 360 view: account + all contacts + all potentials."""
    with get_session() as session:
        # Try by exact ID first, then fuzzy by name
        account = session.execute(
            select(Account).where(Account.account_id == account_name_or_id)
        ).scalar_one_or_none()
        if not account:
            accounts = session.execute(
                select(Account)
                .where(Account.account_name.ilike(f"%{account_name_or_id}%"))
                .limit(5)
            ).scalars().all()
            if not accounts:
                return {"error": "not_found", "query": account_name_or_id}
            if len(accounts) > 1:
                return {
                    "ambiguous": True,
                    "matches": [{"account_id": a.account_id, "account_name": a.account_name, "industry": a.industry} for a in accounts],
                }
            account = accounts[0]

        result = _serialise_account(account)
        result["description"] = account.description

        # Contacts
        contacts = session.execute(
            select(Contact).where(Contact.account_id == account.account_id)
        ).scalars().all()
        result["contacts"] = [_serialise_contact(c, account) for c in contacts]

        # Potentials
        pot_rows = session.execute(
            select(Potential, Contact)
            .outerjoin(Contact, Potential.contact_id == Contact.contact_id)
            .where(Potential.account_id == account.account_id)
            .order_by(Potential.modified_time.desc())
        ).all()
        result["potentials"] = [_serialise_potential(p, account, c) for p, c in pot_rows]

        # Aggregates
        result["totals"] = {
            "contacts_count": len(contacts),
            "potentials_count": len(pot_rows),
            "open_potentials_count": sum(
                1 for p, _ in pot_rows
                if (p.stage or "") not in ("Closed", "Closed Won", "Closed Lost", "Lost", "Disqualified")
            ),
            "total_pipeline_value": sum(float(p.amount or 0) for p, _ in pot_rows),
        }

        return result


# ── Tool 5: search_contacts ──────────────────────────────────────────────────

def search_contacts(
    name_like: str | None = None,
    email_like: str | None = None,
    account_name_like: str | None = None,
    department: str | None = None,
    has_account: bool | None = None,
    limit: int = 25,
) -> dict[str, Any]:
    """Filter contacts."""
    limit = min(limit or 25, MAX_LIMIT)

    with get_session() as session:
        stmt = select(Contact, Account).outerjoin(Account, Contact.account_id == Account.account_id)

        if name_like:
            stmt = stmt.where(Contact.full_name.ilike(f"%{name_like}%"))
        if email_like:
            stmt = stmt.where(Contact.email.ilike(f"%{email_like}%"))
        if account_name_like:
            stmt = stmt.where(Account.account_name.ilike(f"%{account_name_like}%"))
        if department:
            stmt = stmt.where(Contact.department.ilike(f"%{department}%"))
        if has_account is True:
            stmt = stmt.where(Contact.account_id.isnot(None))
        elif has_account is False:
            stmt = stmt.where(Contact.account_id.is_(None))

        count_stmt = select(func.count()).select_from(stmt.subquery())
        total = session.execute(count_stmt).scalar() or 0

        rows = session.execute(stmt.limit(limit)).all()
        items = [_serialise_contact(c, a) for c, a in rows]

    return {"total": total, "returned": len(items), "items": items}


# ── Tool 6: get_contact_details ──────────────────────────────────────────────

def get_contact_details(contact_name_or_email: str) -> dict[str, Any]:
    """Single contact: full info + linked account + linked potentials."""
    with get_session() as session:
        rows = session.execute(
            select(Contact, Account)
            .outerjoin(Account, Contact.account_id == Account.account_id)
            .where(or_(
                Contact.full_name.ilike(f"%{contact_name_or_email}%"),
                Contact.email.ilike(f"%{contact_name_or_email}%"),
            ))
            .limit(5)
        ).all()
        if not rows:
            return {"error": "not_found", "query": contact_name_or_email}
        if len(rows) > 1:
            return {
                "ambiguous": True,
                "matches": [_serialise_contact(c, a) for c, a in rows],
            }
        contact, account = rows[0]
        result = _serialise_contact(contact, account)

        # Linked potentials
        pot_rows = session.execute(
            select(Potential)
            .where(Potential.contact_id == contact.contact_id)
            .order_by(Potential.modified_time.desc())
        ).scalars().all()
        result["potentials"] = [_serialise_potential(p, account, contact) for p in pot_rows]
        return result


# ── Tool 7: pipeline_summary ─────────────────────────────────────────────────

def pipeline_summary(
    group_by: str = "stage",
    services: list[str] | None = None,
    owner_name_like: str | None = None,
    only_open: bool = True,
) -> dict[str, Any]:
    """Aggregations grouped by stage / service / owner / country / lead_source / type / deal_size."""
    closed_stages = ["Closed", "Closed Won", "Closed Lost", "Lost", "Disqualified"]

    field_map = {
        "stage": Potential.stage,
        "service": Potential.service,
        "sub_service": Potential.sub_service,
        "owner": Potential.potential_owner_name,
        "country": Account.billing_country,
        "lead_source": Potential.lead_source,
        "type": Potential.type,
        "deal_size": Potential.deal_size,
    }
    if group_by not in field_map:
        return {"error": f"Invalid group_by '{group_by}'. Allowed: {list(field_map.keys())}"}

    group_col = field_map[group_by]

    with get_session() as session:
        stmt = (
            select(
                group_col.label("group"),
                func.count(Potential.potential_id).label("count"),
                func.sum(Potential.amount).label("total_value"),
                func.avg(Potential.amount).label("avg_value"),
            )
            .outerjoin(Account, Potential.account_id == Account.account_id)
            .group_by(group_col)
            .order_by(func.count(Potential.potential_id).desc())
        )

        if only_open:
            stmt = stmt.where(or_(Potential.stage.notin_(closed_stages), Potential.stage.is_(None)))
        if services:
            stmt = stmt.where(Potential.service.in_(services))
        if owner_name_like:
            stmt = stmt.where(Potential.potential_owner_name.ilike(f"%{owner_name_like}%"))

        rows = session.execute(stmt).all()

    groups = []
    overall_count = 0
    overall_value = 0.0
    for g, count, total, avg in rows:
        overall_count += int(count or 0)
        overall_value += float(total or 0)
        groups.append({
            "group": g or "(none)",
            "count": int(count or 0),
            "total_value": float(total or 0),
            "avg_value": float(avg or 0),
        })

    return {
        "group_by": group_by,
        "scope": "open_only" if only_open else "all",
        "totals": {"count": overall_count, "total_value": overall_value},
        "groups": groups,
    }


# ── Tool 8: revenue_summary ──────────────────────────────────────────────────

def revenue_summary(
    period: str = "current_quarter",
    owner_name_like: str | None = None,
    services: list[str] | None = None,
    include_lost: bool = False,
) -> dict[str, Any]:
    """Revenue / pipeline numbers for a period.

    period: current_quarter, last_quarter, current_month, last_month,
            current_year, last_year, all_time, last_30_days, last_90_days
    """
    now = _now()
    start: datetime | None = None
    end: datetime | None = None

    if period == "current_month":
        start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    elif period == "last_month":
        first_this = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        end = first_this
        last_prev = first_this - timedelta(days=1)
        start = last_prev.replace(day=1)
    elif period == "current_quarter":
        q = (now.month - 1) // 3
        start = now.replace(month=q * 3 + 1, day=1, hour=0, minute=0, second=0, microsecond=0)
    elif period == "last_quarter":
        q = (now.month - 1) // 3
        start_this_q = now.replace(month=q * 3 + 1, day=1, hour=0, minute=0, second=0, microsecond=0)
        end = start_this_q
        last_q_month = q * 3 + 1 - 3
        last_q_year = now.year
        if last_q_month <= 0:
            last_q_month += 12
            last_q_year -= 1
        start = now.replace(year=last_q_year, month=last_q_month, day=1, hour=0, minute=0, second=0, microsecond=0)
    elif period == "current_year":
        start = now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
    elif period == "last_year":
        start = now.replace(year=now.year - 1, month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
        end = now.replace(year=now.year, month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
    elif period == "last_30_days":
        start = now - timedelta(days=30)
    elif period == "last_90_days":
        start = now - timedelta(days=90)
    elif period == "all_time":
        start = None

    closed_stages = ["Closed", "Closed Won", "Closed Lost", "Lost", "Disqualified"]

    with get_session() as session:
        # Pipeline (open) value
        open_stmt = select(
            func.count(Potential.potential_id),
            func.sum(Potential.amount),
            func.sum(Potential.amount * Potential.probability / 100.0),
        ).where(or_(Potential.stage.notin_(closed_stages), Potential.stage.is_(None)))
        if start is not None:
            open_stmt = open_stmt.where(Potential.closing_date >= start)
        if end is not None:
            open_stmt = open_stmt.where(Potential.closing_date < end)
        if services:
            open_stmt = open_stmt.where(Potential.service.in_(services))
        if owner_name_like:
            open_stmt = open_stmt.where(Potential.potential_owner_name.ilike(f"%{owner_name_like}%"))
        open_count, open_total, open_weighted = session.execute(open_stmt).one()

        # Closed-won
        won_stages = ["Closed", "Closed Won"]
        won_stmt = select(
            func.count(Potential.potential_id),
            func.sum(Potential.amount),
        ).where(Potential.stage.in_(won_stages))
        if start is not None:
            won_stmt = won_stmt.where(Potential.closing_date >= start)
        if end is not None:
            won_stmt = won_stmt.where(Potential.closing_date < end)
        if services:
            won_stmt = won_stmt.where(Potential.service.in_(services))
        if owner_name_like:
            won_stmt = won_stmt.where(Potential.potential_owner_name.ilike(f"%{owner_name_like}%"))
        won_count, won_total = session.execute(won_stmt).one()

        # Lost (if requested)
        lost_data = None
        if include_lost:
            lost_stages = ["Lost", "Closed Lost", "Disqualified"]
            lost_stmt = select(
                func.count(Potential.potential_id),
                func.sum(Potential.amount),
            ).where(Potential.stage.in_(lost_stages))
            if start is not None:
                lost_stmt = lost_stmt.where(Potential.closing_date >= start)
            if end is not None:
                lost_stmt = lost_stmt.where(Potential.closing_date < end)
            if services:
                lost_stmt = lost_stmt.where(Potential.service.in_(services))
            if owner_name_like:
                lost_stmt = lost_stmt.where(Potential.potential_owner_name.ilike(f"%{owner_name_like}%"))
            lc, lt = session.execute(lost_stmt).one()
            lost_data = {"count": int(lc or 0), "total_value": float(lt or 0)}

    return {
        "period": period,
        "filters": {"services": services, "owner_name_like": owner_name_like},
        "open_pipeline": {
            "count": int(open_count or 0),
            "total_value": float(open_total or 0),
            "weighted_value": float(open_weighted or 0),
        },
        "closed_won": {
            "count": int(won_count or 0),
            "total_value": float(won_total or 0),
        },
        "lost": lost_data,
    }


# ── Tool 9: time_based_query ─────────────────────────────────────────────────

def time_based_query(
    query_type: str,
    days: int = 7,
    hours: int | None = None,
    services: list[str] | None = None,
    limit: int = 25,
) -> dict[str, Any]:
    """Predefined time-based slices.

    query_type:
      - closing_in_days        — open potentials closing in next N days
      - closing_overdue        — open potentials whose closing date has passed
      - created_in_days        — potentials created in last N days
      - modified_in_days       — potentials modified in last N days (rolling window, e.g. days=1 = last 24h)
      - modified_in_hours      — potentials modified in last N hours (use this for "last 24 hours" → hours=24)
      - modified_today         — potentials modified since midnight (calendar day, NOT a 24h window)
      - no_activity_days       — potentials with no activity in last N days
      - stale_in_stage         — potentials whose modified_time is N+ days ago (proxy for "stuck in stage")
    """
    limit = min(limit or 25, MAX_LIMIT)
    now = _now()
    closed_stages = ["Closed", "Closed Won", "Closed Lost", "Lost", "Disqualified"]

    with get_session() as session:
        stmt = (
            select(Potential, Account, Contact)
            .outerjoin(Account, Potential.account_id == Account.account_id)
            .outerjoin(Contact, Potential.contact_id == Contact.contact_id)
        )

        if query_type == "closing_in_days":
            cutoff = now + timedelta(days=days)
            stmt = stmt.where(
                Potential.closing_date >= now,
                Potential.closing_date <= cutoff,
                or_(Potential.stage.notin_(closed_stages), Potential.stage.is_(None)),
            ).order_by(Potential.closing_date.asc())
        elif query_type == "closing_overdue":
            stmt = stmt.where(
                Potential.closing_date < now,
                or_(Potential.stage.notin_(closed_stages), Potential.stage.is_(None)),
            ).order_by(Potential.closing_date.asc())
        elif query_type == "created_in_days":
            cutoff = now - timedelta(days=days)
            stmt = stmt.where(Potential.created_time >= cutoff).order_by(Potential.created_time.desc())
        elif query_type == "modified_in_days":
            cutoff = now - timedelta(days=days)
            stmt = stmt.where(Potential.modified_time >= cutoff).order_by(Potential.modified_time.desc())
        elif query_type == "modified_in_hours":
            cutoff = now - timedelta(hours=(hours or 24))
            stmt = stmt.where(Potential.modified_time >= cutoff).order_by(Potential.modified_time.desc())
        elif query_type == "modified_today":
            today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
            stmt = stmt.where(Potential.modified_time >= today_start).order_by(Potential.modified_time.desc())
        elif query_type in ("no_activity_days", "stale_in_stage"):
            cutoff = now - timedelta(days=days)
            stmt = stmt.where(
                Potential.modified_time < cutoff,
                or_(Potential.stage.notin_(closed_stages), Potential.stage.is_(None)),
            ).order_by(Potential.modified_time.asc())
        else:
            return {"error": f"Invalid query_type '{query_type}'"}

        if services:
            stmt = stmt.where(Potential.service.in_(services))

        count_stmt = select(func.count()).select_from(stmt.subquery())
        total = session.execute(count_stmt).scalar() or 0

        rows = session.execute(stmt.limit(limit)).all()
        items = [_serialise_potential(p, a, c) for p, a, c in rows]

    return {"query_type": query_type, "days": days, "total": total, "returned": len(items), "items": items}


# ── Tool 9b: recent_activity ─────────────────────────────────────────────────

# Friendly grouping of raw activity_type values into broad categories
ACTIVITY_CATEGORY = {
    "note_added": "notes",
    "note_deleted": "notes",
    "note_updated": "notes",
    "todo_created": "todos",
    "todo_updated": "todos",
    "todo_deleted": "todos",
    "file_uploaded": "files",
    "file_deleted": "files",
    "email_sent": "emails",
    "call_logged": "calls",
    "stage_changed": "stage_changes",
    "field_updated": "field_updates",
    "potential_created": "potentials_created",
}


def recent_activity(
    hours: int | None = None,
    days: int | None = None,
    activity_types: list[str] | None = None,
    categories: list[str] | None = None,
    performed_by_name_like: str | None = None,
    potential_number_or_name: str | None = None,
    limit: int = 50,
) -> dict[str, Any]:
    """Query the CX_Activities audit log to find what the sales team actually DID
    in a time window. This is the source of truth for "action / activity / touched /
    worked on" questions because it captures notes, todos, files, emails, stage
    changes and field updates — not just direct potential row edits.

    Provide either `hours` (e.g. 24) or `days` (e.g. 1) for the time window.

    Filters:
      - activity_types: exact list of raw types (e.g. ['note_added', 'email_sent'])
      - categories: broad categories ['notes','todos','files','emails','calls',
        'stage_changes','field_updates','potentials_created']
      - performed_by_name_like: substring match on user name
      - potential_number_or_name: only activities for this potential

    Returns: time window, total count, per-category rollup, per-user rollup,
    per-potential rollup (top 10), and a sample of recent activities.
    """
    limit = min(limit or 50, MAX_LIMIT)
    now = _now()

    # Default window = last 24 hours if neither given
    if hours is None and days is None:
        hours = 24
    if hours is not None:
        cutoff = now - timedelta(hours=hours)
        window_label = f"last {hours} hour{'s' if hours != 1 else ''}"
    else:
        cutoff = now - timedelta(days=days or 1)
        window_label = f"last {days} day{'s' if days != 1 else ''}"

    # Resolve potential filter (UUID needed)
    target_potential_id: str | None = None
    target_potential_label: str | None = None
    with get_session() as session:
        if potential_number_or_name:
            p = session.execute(
                select(Potential).where(Potential.potential_number == potential_number_or_name)
            ).scalar_one_or_none()
            if not p:
                p = session.execute(
                    select(Potential)
                    .where(Potential.potential_name.ilike(f"%{potential_number_or_name}%"))
                    .order_by(Potential.modified_time.desc())
                    .limit(1)
                ).scalar_one_or_none()
            if not p:
                return {"error": "potential_not_found", "query": potential_number_or_name}
            target_potential_id = p.potential_id
            target_potential_label = f"#{p.potential_number} {p.potential_name or ''}".strip()

        # Resolve user filter
        target_user_ids: list[str] | None = None
        if performed_by_name_like:
            users = session.execute(
                select(User).where(or_(
                    User.name.ilike(f"%{performed_by_name_like}%"),
                    User.email.ilike(f"%{performed_by_name_like}%"),
                ))
            ).scalars().all()
            target_user_ids = [u.user_id for u in users] if users else []
            if not target_user_ids:
                return {
                    "window": window_label,
                    "total": 0,
                    "items": [],
                    "warning": f"No user matched '{performed_by_name_like}'",
                }

        # Expand category filters into raw types
        effective_types: set[str] | None = None
        if activity_types:
            effective_types = set(activity_types)
        if categories:
            cat_types = {t for t, c in ACTIVITY_CATEGORY.items() if c in categories}
            effective_types = (effective_types or set()) | cat_types

        # Base query
        stmt = (
            select(CXActivity, Potential, Account)
            .outerjoin(Potential, CXActivity.potential_id == Potential.potential_id)
            .outerjoin(Account, Potential.account_id == Account.account_id)
            .where(
                CXActivity.created_time >= cutoff,
                CXActivity.is_active == True,
            )
        )
        if target_potential_id:
            stmt = stmt.where(CXActivity.potential_id == target_potential_id)
        if target_user_ids is not None:
            stmt = stmt.where(CXActivity.performed_by_user_id.in_(target_user_ids))
        if effective_types:
            stmt = stmt.where(CXActivity.activity_type.in_(list(effective_types)))

        # Total count
        count_stmt = select(func.count()).select_from(stmt.subquery())
        total = session.execute(count_stmt).scalar() or 0

        # Recent items
        stmt = stmt.order_by(CXActivity.created_time.desc())
        rows = session.execute(stmt.limit(limit)).all()

        # Per-user name lookup for the IDs we encounter
        user_ids_seen = list({a.performed_by_user_id for a, _, _ in rows if a.performed_by_user_id})
        user_name_map: dict[str, str] = {}
        if user_ids_seen:
            users = session.execute(
                select(User).where(User.user_id.in_(user_ids_seen))
            ).scalars().all()
            user_name_map = {u.user_id: u.name for u in users}

    # Build rollups (operate on raw `rows` for category/user/potential breakdowns)
    by_category: dict[str, int] = {}
    by_user: dict[str, int] = {}
    by_potential: dict[str, dict[str, Any]] = {}
    items: list[dict[str, Any]] = []

    for activity, pot, acc in rows:
        cat = ACTIVITY_CATEGORY.get(activity.activity_type, "other")
        by_category[cat] = by_category.get(cat, 0) + 1

        user_label = user_name_map.get(activity.performed_by_user_id or "", activity.performed_by_user_id or "unknown")
        by_user[user_label] = by_user.get(user_label, 0) + 1

        if pot:
            key = pot.potential_number or pot.potential_id
            if key not in by_potential:
                by_potential[key] = {
                    "potential_number": pot.potential_number,
                    "name": pot.potential_name,
                    "account_name": acc.account_name if acc else None,
                    "stage": pot.stage,
                    "activity_count": 0,
                }
            by_potential[key]["activity_count"] += 1

        items.append({
            "id": activity.id,
            "type": activity.activity_type,
            "category": cat,
            "description": activity.description,
            "performed_by": user_label,
            "when": activity.created_time.isoformat() if activity.created_time else None,
            "potential_number": pot.potential_number if pot else None,
            "potential_name": pot.potential_name if pot else None,
            "account_name": acc.account_name if acc else None,
        })

    # Top potentials by activity count
    top_potentials = sorted(by_potential.values(), key=lambda x: x["activity_count"], reverse=True)[:10]

    return {
        "window": window_label,
        "filters": {
            "activity_types": activity_types,
            "categories": categories,
            "performed_by_name_like": performed_by_name_like,
            "potential": target_potential_label,
        },
        "total": int(total),
        "returned": len(items),
        "by_category": [{"category": k, "count": v} for k, v in sorted(by_category.items(), key=lambda x: -x[1])],
        "by_user": [{"user": k, "count": v} for k, v in sorted(by_user.items(), key=lambda x: -x[1])],
        "top_potentials": top_potentials,
        "items": items,
    }


# ── Tool 10: get_potential_full_context ──────────────────────────────────────

def get_potential_full_context(potential_number_or_name: str) -> dict[str, Any]:
    """Load the FULL rich context of a single potential — fields + contact + account
    + ALL notes + ALL open todos + last 10 sent emails + completed AI agent insights.

    Use this whenever the user wants to deeply reason about a specific potential:
    drafting emails, deciding next steps, summarising the conversation history,
    risks, recommendations, etc. This is the same context the per-potential chat
    agent uses.
    """
    # Resolve to potential_id (UUID) first
    with get_session() as session:
        # Try by number
        p = session.execute(
            select(Potential).where(Potential.potential_number == potential_number_or_name)
        ).scalar_one_or_none()
        if not p:
            # Fuzzy by name
            matches = session.execute(
                select(Potential)
                .where(Potential.potential_name.ilike(f"%{potential_number_or_name}%"))
                .order_by(Potential.modified_time.desc())
                .limit(5)
            ).scalars().all()
            if not matches:
                return {"error": "not_found", "query": potential_number_or_name}
            if len(matches) > 1:
                return {
                    "ambiguous": True,
                    "matches": [
                        {"potential_number": m.potential_number, "name": m.potential_name, "stage": m.stage}
                        for m in matches
                    ],
                }
            p = matches[0]
        potential_id = p.potential_id
        potential_number = p.potential_number

    # Lazy import to avoid circular import
    from api.services.chat_service import build_context_prompt
    try:
        context_text = build_context_prompt(potential_id)
    except Exception as e:
        logger.exception("Failed to build full context for %s: %s", potential_id, e)
        return {"error": "context_build_failed", "message": str(e)}

    return {
        "potential_number": potential_number,
        "context": context_text,
    }


# ── Tool 11: list_owners ─────────────────────────────────────────────────────

def list_owners(name_like: str | None = None) -> dict[str, Any]:
    """List active users (owners). Used to resolve 'who is X' or 'whose pipeline is biggest'."""
    with get_session() as session:
        stmt = select(User).where(User.is_active == True)
        if name_like:
            stmt = stmt.where(or_(
                User.name.ilike(f"%{name_like}%"),
                User.email.ilike(f"%{name_like}%"),
            ))
        users = session.execute(stmt).scalars().all()
        return {
            "items": [
                {
                    "user_id": u.user_id,
                    "name": u.name,
                    "email": u.email,
                    "role": u.role,
                }
                for u in users
            ]
        }


# ── Tool registry — exposed to Claude ────────────────────────────────────────

TOOL_FUNCTIONS = {
    "search_potentials": search_potentials,
    "get_potential_details": get_potential_details,
    "get_potential_full_context": get_potential_full_context,
    "search_accounts": search_accounts,
    "get_account_360": get_account_360,
    "search_contacts": search_contacts,
    "get_contact_details": get_contact_details,
    "pipeline_summary": pipeline_summary,
    "revenue_summary": revenue_summary,
    "time_based_query": time_based_query,
    "recent_activity": recent_activity,
    "list_owners": list_owners,
}


# ── Anthropic tool schemas ───────────────────────────────────────────────────

TOOL_SCHEMAS: list[dict[str, Any]] = [
    {
        "name": "search_potentials",
        "description": (
            "Filter potentials by stage, service, owner, country, account name, "
            "amount range, closing date range, creation date, flags (diamond/platinum), type, size. "
            "Returns up to 25 matching potentials with summary fields, plus a total match count."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "stages": {"type": "array", "items": {"type": "string"}, "description": "Filter by stage names exactly. Examples: 'Prospects', 'Pre Qualified', 'Proposal', 'Contracting', 'Closed', 'Lost'"},
                "services": {"type": "array", "items": {"type": "string"}, "description": "Filter by service category names exactly"},
                "owner_name_like": {"type": "string", "description": "Substring match on owner name"},
                "country": {"type": "string", "description": "Substring match on billing country"},
                "account_name_like": {"type": "string", "description": "Substring match on account/company name"},
                "min_amount": {"type": "number"},
                "max_amount": {"type": "number"},
                "closing_after": {"type": "string", "description": "ISO date YYYY-MM-DD"},
                "closing_before": {"type": "string", "description": "ISO date YYYY-MM-DD"},
                "created_after": {"type": "string", "description": "ISO date YYYY-MM-DD"},
                "has_next_step": {"type": "boolean"},
                "is_diamond": {"type": "boolean", "description": "Diamond-tier potentials (Potential2Close = 1)"},
                "is_platinum": {"type": "boolean", "description": "Platinum / hot potentials"},
                "type": {"type": "string", "description": "Potential type, e.g. 'New Business', 'Existing Business'"},
                "deal_size": {"type": "string", "description": "e.g. 'Small', 'Medium', 'Large'"},
                "sort_by": {"type": "string", "enum": ["modified_desc", "amount_desc", "amount_asc", "closing_asc", "created_desc"], "default": "modified_desc"},
                "limit": {"type": "integer", "default": 25, "maximum": 50},
            },
        },
    },
    {
        "name": "get_potential_details",
        "description": "Get full details of a single potential by 7-digit potential number or by name. Returns all fields, last activity, notes count, open todos. If multiple matches, returns ambiguous list.",
        "input_schema": {
            "type": "object",
            "properties": {
                "potential_number_or_name": {"type": "string", "description": "Either the 7-digit potential number or the potential name"},
            },
            "required": ["potential_number_or_name"],
        },
    },
    {
        "name": "get_potential_full_context",
        "description": (
            "Load the FULL deep context for a single potential — all fields, contact, account, "
            "ALL notes (full content), open todos, last 10 sent emails (with bodies), and completed "
            "AI agent insights (research, solution brief, next-action recommendations). "
            "**Use this whenever the user wants to deeply reason about a specific potential**: drafting "
            "follow-up emails, deciding next steps, summarising the potential history, identifying risks, "
            "checking what's been discussed in emails, what notes were added, what the AI research "
            "found, or any question that requires more than just basic potential fields. "
            "Prefer this over `get_potential_details` when the question needs context, judgement, "
            "or content from notes/emails/AI insights."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "potential_number_or_name": {"type": "string", "description": "7-digit potential number or potential name"},
            },
            "required": ["potential_number_or_name"],
        },
    },
    {
        "name": "search_accounts",
        "description": "Filter accounts (companies) by industry, country, name, rating, has open potentials, min revenue.",
        "input_schema": {
            "type": "object",
            "properties": {
                "industry": {"type": "string"},
                "country": {"type": "string"},
                "account_name_like": {"type": "string"},
                "has_open_potentials": {"type": "boolean"},
                "rating": {"type": "string"},
                "min_revenue": {"type": "number"},
                "sort_by": {"type": "string", "enum": ["name_asc", "revenue_desc", "created_desc"], "default": "name_asc"},
                "limit": {"type": "integer", "default": 25, "maximum": 50},
            },
        },
    },
    {
        "name": "get_account_360",
        "description": "Full 360 view of one account: account info + all contacts + all potentials + aggregates. Use this for 'show me everything about [account]' style questions.",
        "input_schema": {
            "type": "object",
            "properties": {
                "account_name_or_id": {"type": "string"},
            },
            "required": ["account_name_or_id"],
        },
    },
    {
        "name": "search_contacts",
        "description": "Filter contacts by name, email, account, department, has-account.",
        "input_schema": {
            "type": "object",
            "properties": {
                "name_like": {"type": "string"},
                "email_like": {"type": "string"},
                "account_name_like": {"type": "string"},
                "department": {"type": "string"},
                "has_account": {"type": "boolean"},
                "limit": {"type": "integer", "default": 25, "maximum": 50},
            },
        },
    },
    {
        "name": "get_contact_details",
        "description": "Get full details of one contact by name or email, including their account and linked potentials.",
        "input_schema": {
            "type": "object",
            "properties": {
                "contact_name_or_email": {"type": "string"},
            },
            "required": ["contact_name_or_email"],
        },
    },
    {
        "name": "pipeline_summary",
        "description": (
            "Aggregate pipeline data grouped by a dimension. Returns count, total_value, avg_value per group. "
            "Use this for 'how is pipeline distributed', 'breakdown by X', 'totals by Y' questions."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "group_by": {"type": "string", "enum": ["stage", "service", "sub_service", "owner", "country", "lead_source", "type", "deal_size"], "default": "stage"},
                "services": {"type": "array", "items": {"type": "string"}},
                "owner_name_like": {"type": "string"},
                "only_open": {"type": "boolean", "default": True, "description": "If True, excludes closed/lost/disqualified potentials"},
            },
        },
    },
    {
        "name": "revenue_summary",
        "description": (
            "Revenue / pipeline numbers for a time period. Returns open pipeline (count, total, weighted) "
            "and closed-won (count, total). Use this for 'total pipeline value', 'revenue this quarter', "
            "'weighted forecast' questions."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "period": {
                    "type": "string",
                    "enum": ["current_quarter", "last_quarter", "current_month", "last_month", "current_year", "last_year", "last_30_days", "last_90_days", "all_time"],
                    "default": "current_quarter",
                },
                "owner_name_like": {"type": "string"},
                "services": {"type": "array", "items": {"type": "string"}},
                "include_lost": {"type": "boolean", "default": False},
            },
        },
    },
    {
        "name": "time_based_query",
        "description": (
            "Predefined time-based queries on potentials. Pick the right query_type:\n"
            "- `closing_in_days` — open potentials closing in next N days\n"
            "- `closing_overdue` — open potentials whose closing date has passed\n"
            "- `created_in_days` — potentials created in the last N days\n"
            "- `modified_in_hours` — potentials modified in last N HOURS (rolling window). **Use this for 'last 24 hours', 'last 12 hours' style questions.** Pass `hours` (e.g. hours=24).\n"
            "- `modified_in_days` — potentials modified in last N DAYS (rolling window). Use for 'last 3 days', 'last week' style questions.\n"
            "- `modified_today` — potentials modified since midnight today (CALENDAR day, not a 24h rolling window). Only use if the user explicitly says 'today' or 'since midnight'.\n"
            "- `no_activity_days` — potentials with NO activity in the last N days (stale)\n"
            "- `stale_in_stage` — potentials sitting untouched for N+ days (proxy for stuck-in-stage)"
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query_type": {
                    "type": "string",
                    "enum": ["closing_in_days", "closing_overdue", "created_in_days", "modified_in_days", "modified_in_hours", "modified_today", "no_activity_days", "stale_in_stage"],
                },
                "days": {"type": "integer", "default": 7, "description": "Number of days. Used by all *_days query types."},
                "hours": {"type": "integer", "description": "Number of hours. Required when query_type is `modified_in_hours`."},
                "services": {"type": "array", "items": {"type": "string"}},
                "limit": {"type": "integer", "default": 25, "maximum": 50},
            },
            "required": ["query_type"],
        },
    },
    {
        "name": "recent_activity",
        "description": (
            "**Source of truth for 'action / activity / touched / worked on / what did the team do' questions.** "
            "Queries the CX_Activities audit log which captures EVERY user action: notes added, todos created/updated, "
            "files uploaded, emails sent, stage changes, field updates, potentials created. "
            "Use this — NOT `time_based_query(modified_in_*)` — whenever the user asks about activity or actions, "
            "because `modified_in_*` only catches direct field edits on the potential row and misses notes/todos/emails. "
            "\n\nDefault window is last 24 hours if neither `hours` nor `days` is given.\n"
            "Returns: total count + per-category breakdown + per-user breakdown + top potentials by activity count + recent items.\n\n"
            "Categories: notes, todos, files, emails, calls, stage_changes, field_updates, potentials_created. "
            "Use the `categories` filter for broad questions; use `activity_types` for specific raw types."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "hours": {"type": "integer", "description": "Time window in hours (e.g. 24 = last 24h). Use this for 'last N hours' style questions."},
                "days": {"type": "integer", "description": "Time window in days. Use this for 'last week', 'last 3 days' style questions."},
                "categories": {
                    "type": "array",
                    "items": {"type": "string", "enum": ["notes", "todos", "files", "emails", "calls", "stage_changes", "field_updates", "potentials_created"]},
                    "description": "Broad activity categories. Omit to include all.",
                },
                "activity_types": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Specific raw activity_type values (e.g. ['note_added','email_sent']). Usually prefer `categories`.",
                },
                "performed_by_name_like": {"type": "string", "description": "Substring match on user name. Use this for 'who did X' or 'X's activity' questions."},
                "potential_number_or_name": {"type": "string", "description": "Limit to one specific potential."},
                "limit": {"type": "integer", "default": 50, "maximum": 50},
            },
        },
    },
    {
        "name": "list_owners",
        "description": "List sales users / owners. Use for 'who is X' resolution or 'list all owners'.",
        "input_schema": {
            "type": "object",
            "properties": {
                "name_like": {"type": "string"},
            },
        },
    },
]
