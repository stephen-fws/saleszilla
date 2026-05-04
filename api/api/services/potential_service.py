"""Potential listing, detail, and filter queries."""

import logging

from sqlalchemy import and_, func, select, or_

logger = logging.getLogger(__name__)

from core.database import get_session
from core.models import Account, Contact, CXQueueItem, Potential, User
from core.schemas import (
    AccountDetailPotential,
    CompanySummary,
    ContactSummary,
    CreatePotentialRequest,
    PotentialDetailResponse,
    PotentialFilterOptions,
    PotentialItem,
    PotentialListResponse,
)
from api.services.activity_service import log_activity


def get_team_user_ids(manager_user_id: str) -> list[str]:
    """Return user_ids of the full reporting subtree under the manager — direct
    reports, their reports, and so on transitively. Walks the `reporting_to`
    hierarchy breadth-first. Returns an empty list if no reports found.

    A CEO (root of the tree) sees all descendant users. Cycles in the
    `reporting_to` data are handled via a visited set.
    """
    with get_session() as session:
        manager = session.get(User, manager_user_id)
        if not manager or not manager.email:
            return []

        # Load all users once and build in-memory graph: BFS down the tree.
        # IsActive filter intentionally dropped — Zoho-imported user rows have
        # inconsistent IsActive values, and excluding them silently drops
        # legitimate reportees from a manager's team subtree.
        rows = session.execute(
            select(User.user_id, User.email, User.reporting_to)
        ).all()

        uid_to_email: dict[str, str] = {}
        tree: dict[str, list[str]] = {}  # manager_email (lower) → [subordinate_uid]
        for uid, email, reports_to in rows:
            if email:
                uid_to_email[uid] = email.lower()
            if reports_to:
                tree.setdefault(reports_to.lower(), []).append(uid)

        visited: set[str] = {manager_user_id}
        team: list[str] = []
        frontier = [manager.email.lower()]
        while frontier:
            next_frontier: list[str] = []
            for mgr_email in frontier:
                for sub_uid in tree.get(mgr_email, []):
                    if sub_uid in visited:
                        continue
                    visited.add(sub_uid)
                    team.append(sub_uid)
                    sub_email = uid_to_email.get(sub_uid)
                    if sub_email:
                        next_frontier.append(sub_email)
            frontier = next_frontier

        return team


def list_potentials(
    stages: list[str] | None = None,
    services: list[str] | None = None,
    owners: list[str] | None = None,
    categories: list[str] | None = None,
    search: str | None = None,
    page: int = 1,
    page_size: int = 100,
    owner_user_id: str | None = None,
    include_team: bool = False,
    created_from: str | None = None,
    created_to: str | None = None,
) -> PotentialListResponse:
    """List potentials with optional filters, joined with Account + Contact.

    When include_team=True and owner_user_id is set, also includes potentials
    owned by the user's direct reports (users whose reporting_to = user's email).
    """
    with get_session() as session:
        stmt = select(Potential, Account, Contact).outerjoin(
            Account, Potential.account_id == Account.account_id
        ).outerjoin(
            Contact, Potential.contact_id == Contact.contact_id
        )

        if owner_user_id:
            if include_team:
                team_ids = get_team_user_ids(owner_user_id)
                all_owner_ids = [owner_user_id] + team_ids
                stmt = stmt.where(Potential.potential_owner_id.in_(all_owner_ids))
            else:
                stmt = stmt.where(Potential.potential_owner_id == owner_user_id)
        if stages:
            stmt = stmt.where(Potential.stage.in_(stages))
        if services:
            stmt = stmt.where(Potential.service.in_(services))
        if owners:
            stmt = stmt.where(Potential.potential_owner_name.in_(owners))
        if categories:
            # Diamond = Potential2Close == 1.
            # Platinum = Hot_Potential='true' AND NOT Diamond (matches _potential_category).
            cat_clauses = []
            wants_diamond = "Diamond" in categories
            wants_platinum = "Platinum" in categories
            if wants_diamond:
                cat_clauses.append(Potential.potential2close == 1)
            if wants_platinum:
                cat_clauses.append(
                    and_(
                        func.lower(func.coalesce(Potential.hot_potential, "false")) == "true",
                        or_(Potential.potential2close == None, Potential.potential2close != 1),  # noqa: E711
                    )
                )
            if cat_clauses:
                stmt = stmt.where(or_(*cat_clauses))
        if search:
            # Strip a leading "#" so users can paste "#0001234" or "0001234".
            search_term = search.lstrip("#").strip()
            term = f"%{search_term}%"
            stmt = stmt.where(
                or_(
                    Potential.potential_name.ilike(term),
                    Potential.potential_number.ilike(term),
                    Account.account_name.ilike(term),
                    Contact.full_name.ilike(term),
                    Contact.email.ilike(term),
                )
            )
        if created_from:
            # Inclusive lower bound — accept either "YYYY-MM-DD" or full ISO.
            from datetime import datetime as _dt
            try:
                cf = _dt.fromisoformat(created_from)
                stmt = stmt.where(Potential.created_time >= cf)
            except ValueError:
                pass
        if created_to:
            # Inclusive upper bound — push to end-of-day so a same-day pick
            # also catches rows created later that day.
            from datetime import datetime as _dt, timedelta as _td
            try:
                ct = _dt.fromisoformat(created_to)
                # If only a date was passed (no time), extend to the end of day.
                if ct.hour == 0 and ct.minute == 0 and ct.second == 0:
                    ct = ct + _td(days=1) - _td(microseconds=1)
                stmt = stmt.where(Potential.created_time <= ct)
            except ValueError:
                pass

        # Count
        count_stmt = select(func.count()).select_from(stmt.subquery())
        total = session.execute(count_stmt).scalar() or 0

        # Paginate
        stmt = stmt.order_by(Potential.created_time.desc())
        stmt = stmt.offset((page - 1) * page_size).limit(page_size)

        rows = session.execute(stmt).all()

        potentials = []
        for p, a, c in rows:
            potentials.append(PotentialItem(
                id=p.potential_id,
                potential_number=p.potential_number,
                category=_potential_category(p),
                title=p.potential_name,
                value=p.amount,
                stage=p.stage,
                probability=p.probability,
                service=p.service,
                sub_service=p.sub_service,
                owner_name=p.potential_owner_name,
                owner_id=p.potential_owner_id,
                closing_date=p.closing_date,
                lead_source=p.lead_source,
                form_url=p.form_url,
                deal_size=p.deal_size,
                deal_type=p.type,
                created_time=p.created_time,
                inquired_on=p.inquired_on,
                company=CompanySummary(
                    id=a.account_id, name=a.account_name, industry=a.industry
                ) if a else None,
                contact=ContactSummary(
                    id=c.contact_id,
                    name=c.full_name or f"{c.first_name or ''} {c.last_name or ''}".strip(),
                    title=c.title,
                    email=c.email,
                ) if c else None,
            ))

        # Filter options scoped to the same owner set as the main query
        scoped_owner_ids = None
        if owner_user_id:
            if include_team:
                scoped_owner_ids = [owner_user_id] + get_team_user_ids(owner_user_id)
            else:
                scoped_owner_ids = [owner_user_id]
        filter_opts = _get_filter_options(session, owner_ids=scoped_owner_ids)

        return PotentialListResponse(
            potentials=potentials,
            total=total,
            filter_options=filter_opts,
        )


def get_potential_detail(potential_id: str) -> PotentialDetailResponse | None:
    """Get full potential detail with account and contact."""
    from core.models import PotentialAttribute
    with get_session() as session:
        stmt = select(Potential, Account, Contact, PotentialAttribute).outerjoin(
            Account, Potential.account_id == Account.account_id
        ).outerjoin(
            Contact, Potential.contact_id == Contact.contact_id
        ).outerjoin(
            PotentialAttribute, PotentialAttribute.potential_number == Potential.potential_number
        ).where(Potential.potential_id == potential_id)

        row = session.execute(stmt).first()
        if not row:
            return None

        p, a, c, attrs = row

        potential_item = PotentialItem(
            id=p.potential_id,
            potential_number=p.potential_number,
            category=_potential_category(p),
            title=p.potential_name,
            value=p.amount,
            stage=p.stage,
            probability=p.probability,
            service=p.service,
            sub_service=p.sub_service,
            owner_name=p.potential_owner_name,
            owner_id=p.potential_owner_id,
            closing_date=p.closing_date,
            lead_source=p.lead_source,
            form_url=p.form_url,
            deal_size=p.deal_size,
            deal_type=p.type,
            created_time=p.created_time,
            inquired_on=p.inquired_on,
            buyer_intent_score=attrs.buyer_intent_score if attrs else None,
            buyer_intent_level=attrs.buyer_intent_level if attrs else None,
            buyer_intent_justification=attrs.buyer_intent_justification if attrs else None,
            company=CompanySummary(
                id=a.account_id, name=a.account_name, industry=a.industry
            ) if a else None,
            contact=ContactSummary(
                id=c.contact_id,
                name=c.full_name or f"{c.first_name or ''} {c.last_name or ''}".strip(),
                title=c.title,
                email=c.email,
            ) if c else None,
        )

        return PotentialDetailResponse(
            potential=potential_item,
            company=potential_item.company,
            contact=potential_item.contact,
            contact_phone=c.phone if c else None,
            contact_mobile=c.mobile if c else None,
            company_website=a.website if a else None,
            company_location=_build_location(a) if a else None,
            company_employees=a.employees if a else None,
            company_revenue=a.annual_revenue if a else None,
            company_description=a.description if a else None,
            next_step=p.next_step,
            description=p.description,
        )


def _get_filter_options(session, owner_ids: list[str] | None = None) -> PotentialFilterOptions:
    """Get distinct owners, services, stages scoped to the given owner IDs.
    If owner_ids is None, returns options from all potentials (legacy/fallback)."""

    base = select(Potential)
    if owner_ids:
        base = base.where(Potential.potential_owner_id.in_(owner_ids))

    owners = [r[0] for r in session.execute(
        select(Potential.potential_owner_name).where(
            Potential.potential_owner_name.isnot(None),
            *([Potential.potential_owner_id.in_(owner_ids)] if owner_ids else []),
        ).distinct().order_by(Potential.potential_owner_name)
    ).all()]

    services = [r[0] for r in session.execute(
        select(Potential.service).where(
            Potential.service.isnot(None),
            *([Potential.potential_owner_id.in_(owner_ids)] if owner_ids else []),
        ).distinct().order_by(Potential.service)
    ).all()]

    stages = [r[0] for r in session.execute(
        select(Potential.stage).where(
            Potential.stage.isnot(None),
            *([Potential.potential_owner_id.in_(owner_ids)] if owner_ids else []),
        ).distinct().order_by(Potential.stage)
    ).all()]

    return PotentialFilterOptions(owners=owners, services=services, stages=stages)


def update_potential(potential_id: str, data: dict, user_id: str | None = None) -> PotentialDetailResponse | None:
    """Patch editable fields on a potential and return updated detail."""
    from datetime import datetime as dt

    _FIELD_MAP = {
        "title": "potential_name",
        "stage": "stage",
        "amount": "amount",
        "probability": "probability",
        "next_step": "next_step",
        "description": "description",
        "service": "service",
        "sub_service": "sub_service",
        "lead_source": "lead_source",
        "form_url": "form_url",
        "deal_type": "type",
        "deal_size": "deal_size",
        "not_an_inquiry_reason": "not_an_inquiry_reason",
        "disqualify_reason": "disqualify_reason",
    }
    _LABELS = {
        "title": "Title",
        "stage": "Stage",
        "amount": "Value",
        "probability": "Probability (%)",
        "next_step": "Next Step",
        "description": "Description",
        "closing_date": "Closing Date",
        "service": "Service",
        "sub_service": "Sub-service",
        "lead_source": "Lead Source",
        "form_url": "Form URL",
        "deal_type": "Type",
        "deal_size": "Size",
        "not_an_inquiry_reason": "Not-an-Inquiry Reason",
        "disqualify_reason": "Disqualify Reason",
    }

    changes: list[tuple[str, str, str]] = []  # (label, old, new)

    with get_session() as session:
        potential = session.get(Potential, potential_id)
        if not potential:
            return None
        for key, col in _FIELD_MAP.items():
            if key in data and data[key] is not None:
                old_val = getattr(potential, col)
                new_val = data[key]
                old_str = str(old_val) if old_val is not None else "—"
                new_str = str(new_val)
                if old_str != new_str:
                    changes.append((_LABELS[key], old_str, new_str))
                setattr(potential, col, new_val)
        if "closing_date" in data and data["closing_date"]:
            try:
                new_date = dt.fromisoformat(data["closing_date"])
                old_date = potential.closing_date
                old_str = old_date.strftime("%Y-%m-%d") if old_date else "—"
                new_str = new_date.strftime("%Y-%m-%d")
                if old_str != new_str:
                    changes.append((_LABELS["closing_date"], old_str, new_str))
                potential.closing_date = new_date
            except ValueError:
                pass
        potential.modified_time = dt.utcnow()
        session.commit()

    for label, old, new in changes:
        activity_type = "stage_changed" if label == "Stage" else "field_updated"
        # Truncate long values (e.g. description)
        old_display = (old[:60] + "…") if len(old) > 63 else old
        new_display = (new[:60] + "…") if len(new) > 63 else new
        log_activity(
            potential_id=potential_id,
            activity_type=activity_type,
            description=f"{label}: '{old_display}' → '{new_display}'",
            user_id=user_id,
        )

    return get_potential_detail(potential_id)


def reassign_potential(
    potential_id: str,
    new_owner_user_id: str,
    by_user_id: str | None = None,
) -> PotentialDetailResponse | None:
    """Transfer ownership of a potential to another user.

    Side effects:
      - Updates Potentials.[Potential Owner Id] / [Potential Owner Name].
      - Logs a CXActivity timeline entry: "Owner changed from X to Y".

    Pending Next Action drafts are NOT cleared — they stay in place and the
    new owner can edit/send them. Signature & tone may need a quick edit
    in the composer.

    Returns None when the potential or target user doesn't exist.
    """
    from datetime import datetime as dt, timezone as _tz

    now = dt.now(_tz.utc)
    with get_session() as session:
        potential = session.get(Potential, potential_id)
        if not potential:
            return None
        new_owner = session.get(User, new_owner_user_id)
        if not new_owner:
            return None

        old_owner_id = potential.potential_owner_id
        old_owner_name = potential.potential_owner_name or "—"
        new_owner_name = new_owner.name or new_owner.email or new_owner_user_id

        if old_owner_id == new_owner_user_id:
            # No-op, return current state.
            return get_potential_detail(potential_id)

        potential.potential_owner_id = new_owner_user_id
        potential.potential_owner_name = new_owner_name
        potential.modified_time = now
        session.add(potential)
        session.flush()

    # Note: pending Next Action drafts are intentionally left in place.
    # Drafts are plain DB rows and the new owner can edit/send them as-is
    # (only the signature, tone, and prior-thread context may feel slightly
    # off for the new owner — all editable in the composer).

    # Timeline
    try:
        from api.services.activity_service import log_activity
        log_activity(
            potential_id=potential_id,
            activity_type="owner_changed",
            description=f"Owner changed from {old_owner_name} to {new_owner_name}",
            user_id=by_user_id,
        )
    except Exception:
        logger.exception("reassign_potential: failed to log activity for %s", potential_id)

    return get_potential_detail(potential_id)


def create_potential(data: CreatePotentialRequest, user: User) -> PotentialDetailResponse:
    """Create potential, resolving account/contact by ID or creating new ones.

    Primary keys (Accounts.account_id, Contacts.contact_id, Potentials.potential_id,
    Potentials."Potential Number") are DB-assigned. We do NOT set them here —
    SQLAlchemy picks up the generated values after flush via OUTPUT INSERTED.
    """
    from datetime import datetime as dt

    if not data.account_id and not data.company:
        raise ValueError("Either account_id or company must be provided")
    if not data.contact_id and not data.contact:
        raise ValueError("Either contact_id or contact must be provided")

    with get_session() as session:
        # ── Resolve account ──────────────────────────────────────────────────
        if data.account_id:
            account = session.get(Account, data.account_id)
            if not account:
                raise ValueError(f"Account {data.account_id} not found")
            # Patch any agent-critical fields that are missing in the account
            if data.company:
                changed = False
                if not account.website and data.company.website:
                    account.website = data.company.website; changed = True
                if not account.billing_country and not account.country_fws and data.company.country:
                    account.billing_country = data.company.country; changed = True
                if not account.industry and data.company.industry:
                    account.industry = data.company.industry; changed = True
                if changed:
                    account.modified_time = dt.utcnow()
                    account.modified_by = user.user_id
                    session.add(account)
                    session.flush()
        else:
            # Find-or-create by name (case-insensitive)
            account = session.execute(
                select(Account).where(Account.account_name.ilike(data.company.name))
            ).scalar_one_or_none()
            if not account:
                account = Account(
                    account_name=data.company.name,
                    phone=data.company.phone,
                    industry=data.company.industry,
                    website=data.company.website,
                    billing_street=data.company.billing_street,
                    billing_city=data.company.billing_city,
                    billing_state=data.company.billing_state,
                    billing_code=data.company.billing_code,
                    billing_country=data.company.country,
                    created_by=user.user_id,
                    modified_by=user.user_id,
                    created_time=dt.utcnow(),
                    modified_time=dt.utcnow(),
                )
                session.add(account)
                session.flush()

        # ── Resolve contact ──────────────────────────────────────────────────
        if data.contact_id:
            contact = session.get(Contact, data.contact_id)
            if not contact:
                raise ValueError(f"Contact {data.contact_id} not found")
        else:
            contact = Contact(
                first_name=data.contact.first_name,
                last_name=data.contact.last_name,
                full_name=data.contact.name,
                title=data.contact.title,
                email=data.contact.email,
                phone=data.contact.phone,
                account_id=account.account_id,
                created_by=user.user_id,
                modified_by=user.user_id,
                created_time=dt.utcnow(),
                modified_time=dt.utcnow(),
            )
            session.add(contact)
            session.flush()

        closing_date = None
        if data.closing_date:
            try:
                closing_date = dt.fromisoformat(data.closing_date)
            except ValueError:
                pass

        potential = Potential(
            potential_name=data.potential_name,
            amount=data.amount,
            stage=data.stage,
            probability=data.probability,
            service=data.service,
            sub_service=data.sub_service,
            lead_source=data.lead_source,
            form_url=data.form_url,
            next_step=data.next_step,
            description=data.description,
            type=data.deal_type,
            deal_size=data.deal_size,
            closing_date=closing_date,
            account_id=account.account_id,
            contact_id=contact.contact_id,
            potential_owner_id=user.user_id,
            potential_owner_name=user.name,
            created_time=dt.utcnow(),
            modified_time=dt.utcnow(),
        )
        session.add(potential)
        session.flush()
        # potential_id (PK) is auto-populated by OUTPUT INSERTED; potential_number
        # is server-generated but not a PK, so re-SELECT the row to pull it back.
        session.refresh(potential, ["potential_number"])
        session.commit()
        # Snapshot DB-assigned values before the session closes
        potential_id = potential.potential_id
        potential_number = potential.potential_number
        account_id = account.account_id
        contact_id = contact.contact_id

    log_activity(
        potential_id=potential_id,
        activity_type="potential_created",
        description=f"Potential created: \"{data.potential_name}\"",
        user_id=user.user_id,
        account_id=account_id,
        contact_id=contact_id,
    )

    # Add to "New Inquiries" queue folder so it appears in Panel 1 → Panel 2
    from datetime import datetime as _dt, timezone as _tz
    _now = _dt.now(_tz.utc)
    with get_session() as session:
        company_name = ""
        if account_id:
            acc = session.get(Account, account_id)
            company_name = acc.account_name if acc else ""
        contact_name = ""
        if contact_id:
            con = session.get(Contact, contact_id)
            contact_name = con.full_name if con else ""

        session.add(CXQueueItem(
            potential_id=potential_number,
            contact_id=contact_id,
            account_id=account_id,
            folder_type="new-inquiries",
            title=data.potential_name or "New Potential",
            subtitle=f"{company_name} · {contact_name}".strip(" ·") or None,
            preview=data.description[:300] if data.description else None,
            time_label=_now.strftime("%H:%M"),
            priority=None,
            status="pending",
            assigned_to_user_id=user.user_id,
            created_time=_now,
            updated_time=_now,
            is_active=True,
        ))
        session.flush()

    try:
        from api.services.agent_service import init_agents_for_potential
        init_agents_for_potential(potential_id, triggered_by="new_potential")
    except Exception as e:
        logger.warning("Failed to trigger agents for new potential %s: %s", potential_id, e)
    return get_potential_detail(potential_id)


def _potential_category(p: "Potential") -> str:
    """Derive Diamond / Platinum / Other from DB flag columns."""
    if (p.potential2close or 0) == 1:
        return "Diamond"
    if (p.hot_potential or "false").lower() == "true":
        return "Platinum"
    return "Other"




def _build_location(a: Account) -> str | None:
    parts = [p for p in [a.billing_city, a.billing_state, a.country_fws or a.billing_country] if p]
    return ", ".join(parts) if parts else None
