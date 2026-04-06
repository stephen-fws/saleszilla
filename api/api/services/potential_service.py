"""Potential listing, detail, and filter queries."""

from sqlalchemy import func, select, or_

from core.database import get_session
from core.models import Account, Contact, Potential, User
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


def list_potentials(
    stages: list[str] | None = None,
    services: list[str] | None = None,
    owners: list[str] | None = None,
    search: str | None = None,
    page: int = 1,
    page_size: int = 100,
    owner_user_id: str | None = None,
) -> PotentialListResponse:
    """List potentials with optional filters, joined with Account + Contact."""
    with get_session() as session:
        stmt = select(Potential, Account, Contact).outerjoin(
            Account, Potential.account_id == Account.account_id
        ).outerjoin(
            Contact, Potential.contact_id == Contact.contact_id
        )

        if owner_user_id:
            stmt = stmt.where(Potential.potential_owner_id == owner_user_id)
        if stages:
            stmt = stmt.where(Potential.stage.in_(stages))
        if services:
            stmt = stmt.where(Potential.service.in_(services))
        if owners:
            stmt = stmt.where(Potential.potential_owner_name.in_(owners))
        if search:
            term = f"%{search}%"
            stmt = stmt.where(
                or_(
                    Potential.potential_name.ilike(term),
                    Account.account_name.ilike(term),
                    Contact.full_name.ilike(term),
                    Contact.email.ilike(term),
                )
            )

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
                title=p.potential_name,
                value=p.amount,
                stage=p.stage,
                probability=p.probability,
                service=p.service,
                sub_service=p.sub_service,
                owner_name=p.potential_owner_name,
                closing_date=p.closing_date,
                lead_source=p.lead_source,
                deal_size=p.deal_size,
                deal_type=p.type,
                created_time=p.created_time,
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

        # Filter options (from all potentials, unfiltered)
        filter_opts = _get_filter_options(session)

        return PotentialListResponse(
            potentials=potentials,
            total=total,
            filter_options=filter_opts,
        )


def get_potential_detail(potential_id: str) -> PotentialDetailResponse | None:
    """Get full potential detail with account and contact."""
    with get_session() as session:
        stmt = select(Potential, Account, Contact).outerjoin(
            Account, Potential.account_id == Account.account_id
        ).outerjoin(
            Contact, Potential.contact_id == Contact.contact_id
        ).where(Potential.potential_id == potential_id)

        row = session.execute(stmt).first()
        if not row:
            return None

        p, a, c = row

        potential_item = PotentialItem(
            id=p.potential_id,
            title=p.potential_name,
            value=p.amount,
            stage=p.stage,
            probability=p.probability,
            service=p.service,
            sub_service=p.sub_service,
            owner_name=p.potential_owner_name,
            closing_date=p.closing_date,
            lead_source=p.lead_source,
            deal_size=p.deal_size,
            deal_type=p.type,
            created_time=p.created_time,
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


def _get_filter_options(session) -> PotentialFilterOptions:
    """Get distinct owners, services, stages from all potentials."""
    owners = [r[0] for r in session.execute(
        select(Potential.potential_owner_name).where(
            Potential.potential_owner_name.isnot(None)
        ).distinct().order_by(Potential.potential_owner_name)
    ).all()]

    services = [r[0] for r in session.execute(
        select(Potential.service).where(
            Potential.service.isnot(None)
        ).distinct().order_by(Potential.service)
    ).all()]

    stages = [r[0] for r in session.execute(
        select(Potential.stage).where(
            Potential.stage.isnot(None)
        ).distinct().order_by(Potential.stage)
    ).all()]

    return PotentialFilterOptions(owners=owners, services=services, stages=stages)


def update_potential(potential_id: str, data: dict, user_id: str | None = None) -> PotentialDetailResponse | None:
    """Patch editable fields on a potential and return updated detail."""
    from datetime import datetime as dt

    _FIELD_MAP = {
        "stage": "stage",
        "amount": "amount",
        "probability": "probability",
        "next_step": "next_step",
        "description": "description",
    }
    _LABELS = {
        "stage": "Stage",
        "amount": "Value",
        "probability": "Probability (%)",
        "next_step": "Next Step",
        "description": "Description",
        "closing_date": "Closing Date",
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


def create_potential(data: CreatePotentialRequest, user: User) -> PotentialDetailResponse:
    """Create potential, resolving account/contact by ID or creating new ones."""
    from uuid import uuid4
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
                    session.add(account)
                    session.flush()
        else:
            # Find-or-create by name (case-insensitive)
            account = session.execute(
                select(Account).where(Account.account_name.ilike(data.company.name))
            ).scalar_one_or_none()
            if not account:
                account = Account(
                    account_id=uuid4().hex,
                    account_name=data.company.name,
                    industry=data.company.industry,
                    website=data.company.website,
                    billing_country=data.company.country,
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
                contact_id=uuid4().hex,
                full_name=data.contact.name,
                title=data.contact.title,
                email=data.contact.email,
                phone=data.contact.phone,
                account_id=account.account_id,
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
            potential_id=uuid4().hex,
            potential_name=data.potential_name,
            amount=data.amount,
            stage=data.stage,
            probability=data.probability,
            service=data.service,
            sub_service=data.sub_service,
            lead_source=data.lead_source,
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
        session.commit()
        potential_id = potential.potential_id
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
    try:
        from api.services.agent_service import init_agents_for_potential
        init_agents_for_potential(potential_id, triggered_by="new_potential")
    except Exception:
        pass
    return get_potential_detail(potential_id)


def _build_location(a: Account) -> str | None:
    parts = [p for p in [a.billing_city, a.billing_state, a.country_fws or a.billing_country] if p]
    return ", ".join(parts) if parts else None
