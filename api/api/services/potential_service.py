"""Potential listing, detail, and filter queries."""

from sqlalchemy import func, select, or_

from core.database import get_session
from core.models import Account, Contact, Potential
from core.schemas import (
    AccountDetailPotential,
    CompanySummary,
    ContactSummary,
    PotentialDetailResponse,
    PotentialFilterOptions,
    PotentialItem,
    PotentialListResponse,
)


def list_potentials(
    stages: list[str] | None = None,
    services: list[str] | None = None,
    owners: list[str] | None = None,
    search: str | None = None,
    page: int = 1,
    page_size: int = 100,
) -> PotentialListResponse:
    """List potentials with optional filters, joined with Account + Contact."""
    with get_session() as session:
        stmt = select(Potential, Account, Contact).outerjoin(
            Account, Potential.account_id == Account.account_id
        ).outerjoin(
            Contact, Potential.contact_id == Contact.contact_id
        )

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


def _build_location(a: Account) -> str | None:
    parts = [p for p in [a.billing_city, a.billing_state, a.country_fws or a.billing_country] if p]
    return ", ".join(parts) if parts else None
