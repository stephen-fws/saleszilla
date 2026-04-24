"""Account listing and detail queries."""

from sqlalchemy import func, select, or_

from core.database import get_session
from core.models import Account, Contact, Potential, CXActivity
from core.schemas import (
    AccountDetailContact,
    AccountDetailPotential,
    AccountDetailResponse,
    AccountFilterOptions,
    AccountItem,
    AccountListResponse,
    ActivityItem,
    ContactSummary,
)


STAGE_PRIORITY = {
    "Closed": 0,
    "Contracting": 1,
    "Proposal": 2,
    "Requirements Capture": 3,
    "Pre Qualified": 4,
    "Prospects": 5,
    "Contact Later": 6,
    "Sleeping": 7,
    "Low Value": 8,
    "Disqualified": 9,
    "Lost": 10,
}


def list_accounts(
    search: str | None = None,
    industries: list[str] | None = None,
    page: int = 1,
    page_size: int = 100,
    owner_user_id: str | None = None,
) -> AccountListResponse:
    """List accounts with deal aggregates."""
    with get_session() as session:
        stmt = select(Account)

        if owner_user_id:
            owned_account_ids = select(Potential.account_id).where(
                Potential.potential_owner_id == owner_user_id,
                Potential.account_id.isnot(None),
            ).distinct()
            stmt = stmt.where(
                or_(
                    Account.account_owner_id == owner_user_id,
                    Account.account_id.in_(owned_account_ids),
                )
            )
        if search:
            stmt = stmt.where(Account.account_name.ilike(f"%{search}%"))
        if industries:
            stmt = stmt.where(Account.industry.in_(industries))

        stmt = stmt.order_by(Account.account_name)
        stmt = stmt.offset((page - 1) * page_size).limit(page_size)

        accounts_orm = session.execute(stmt).scalars().all()
        account_ids = [a.account_id for a in accounts_orm]

        if not account_ids:
            filter_opts = _get_account_filter_options(session)
            return AccountListResponse(accounts=[], total=0, filter_options=filter_opts)

        # Aggregate potentials per account
        agg_stmt = select(
            Potential.account_id,
            func.count(Potential.potential_id).label("deal_count"),
            func.coalesce(func.sum(Potential.amount), 0).label("total_value"),
        ).where(
            Potential.account_id.in_(account_ids)
        ).group_by(Potential.account_id)

        agg_rows = {r[0]: (r[1], r[2]) for r in session.execute(agg_stmt).all()}

        # Contact counts
        contact_stmt = select(
            Contact.account_id,
            func.count(Contact.contact_id).label("contact_count"),
        ).where(
            Contact.account_id.in_(account_ids)
        ).group_by(Contact.account_id)

        contact_counts = {r[0]: r[1] for r in session.execute(contact_stmt).all()}

        # Top stage per account
        stage_stmt = select(
            Potential.account_id, Potential.stage
        ).where(
            Potential.account_id.in_(account_ids),
            Potential.stage.isnot(None),
        )
        stage_rows = session.execute(stage_stmt).all()
        top_stages: dict[str, str] = {}
        for aid, stage in stage_rows:
            current = top_stages.get(aid)
            if current is None or STAGE_PRIORITY.get(stage, 99) < STAGE_PRIORITY.get(current, 99):
                top_stages[aid] = stage

        items = []
        for a in accounts_orm:
            deal_count, total_value = agg_rows.get(a.account_id, (0, 0))
            items.append(AccountItem(
                id=a.account_id,
                name=a.account_name,
                industry=a.industry,
                location=_build_location(a),
                website=a.website,
                country=a.billing_country or a.country_fws,
                deal_count=deal_count,
                contact_count=contact_counts.get(a.account_id, 0),
                total_value=float(total_value or 0),
                top_stage=top_stages.get(a.account_id),
            ))

        # Total count (same filters applied)
        count_base = select(func.count(Account.account_id))
        if owner_user_id:
            count_base = count_base.where(Account.account_id.in_(owned_account_ids))
        if search:
            count_base = count_base.where(Account.account_name.ilike(f"%{search}%"))
        if industries:
            count_base = count_base.where(Account.industry.in_(industries))
        total = session.execute(count_base).scalar() or 0

        filter_opts = _get_account_filter_options(session)

        return AccountListResponse(accounts=items, total=total, filter_options=filter_opts)


def get_account_detail(account_id: str) -> AccountDetailResponse | None:
    """Get account detail with contacts, potentials, activities."""
    with get_session() as session:
        account = session.get(Account, account_id)
        if not account:
            return None

        # Contacts
        contacts_orm = session.execute(
            select(Contact).where(Contact.account_id == account_id)
        ).scalars().all()

        contacts = [
            AccountDetailContact(
                id=c.contact_id,
                name=c.full_name or f"{c.first_name or ''} {c.last_name or ''}".strip(),
                title=c.title,
                email=c.email,
                phone=c.phone,
                mobile=c.mobile,
                department=c.department,
            )
            for c in contacts_orm
        ]

        # Potentials with contact info
        pot_stmt = select(Potential, Contact).outerjoin(
            Contact, Potential.contact_id == Contact.contact_id
        ).where(Potential.account_id == account_id)

        pot_rows = session.execute(pot_stmt).all()
        potentials = [
            AccountDetailPotential(
                id=p.potential_id,
                title=p.potential_name,
                value=p.amount,
                stage=p.stage,
                probability=p.probability,
                service=p.service,
                owner_name=p.potential_owner_name,
                contact=ContactSummary(
                    id=c.contact_id,
                    name=c.full_name or f"{c.first_name or ''} {c.last_name or ''}".strip(),
                    title=c.title,
                    email=c.email,
                ) if c else None,
            )
            for p, c in pot_rows
        ]

        # Recent activities
        act_stmt = select(CXActivity).where(
            CXActivity.account_id == account_id,
            CXActivity.is_active == True,
        ).order_by(CXActivity.created_time.desc()).limit(20)

        activities = [
            ActivityItem(
                id=a.id,
                potential_id=a.potential_id,
                activity_type=a.activity_type,
                description=a.description,
                performed_by_user_id=a.performed_by_user_id,
                created_time=a.created_time,
            )
            for a in session.execute(act_stmt).scalars().all()
        ]

        return AccountDetailResponse(
            id=account.account_id,
            name=account.account_name,
            industry=account.industry,
            website=account.website,
            location=_build_location(account),
            phone=account.phone,
            billing_street=account.billing_street,
            billing_city=account.billing_city,
            billing_state=account.billing_state,
            billing_code=account.billing_code,
            billing_country=account.country_fws or account.billing_country,
            employees=account.employees,
            revenue=account.annual_revenue,
            description=account.description,
            contacts=contacts,
            potentials=potentials,
            activities=activities,
        )


def update_account(account_id: str, data: dict, user_id: str | None = None) -> AccountDetailResponse | None:
    """Patch editable fields on an account and return the updated detail.

    user_id is recorded in Accounts.[Modified By] so the audit trail shows who
    made the change (handy when managers edit a reportee's account).
    """
    from datetime import datetime as dt
    field_map = {
        "name": "account_name",
        "industry": "industry",
        "website": "website",
        "phone": "phone",
        "employees": "employees",
        "revenue": "annual_revenue",
        "description": "description",
        "billing_street": "billing_street",
        "billing_city": "billing_city",
        "billing_state": "billing_state",
        "billing_code": "billing_code",
        "billing_country": "billing_country",
    }
    with get_session() as session:
        account = session.get(Account, account_id)
        if not account:
            return None
        for key, col in field_map.items():
            if key in data and data[key] is not None:
                setattr(account, col, data[key])
        account.modified_time = dt.utcnow()
        if user_id:
            account.modified_by = user_id
        session.commit()
    return get_account_detail(account_id)


def _get_account_filter_options(session) -> AccountFilterOptions:
    """Filter sidebar industries come from the curated `industries` table so the
    Panel 1 list stays consistent with the New Potential dropdown. Legacy
    Zoho-imported accounts whose industry strings aren't in the curated list
    will simply return zero matches when filtered — acceptable tradeoff."""
    from sqlalchemy import text
    industries = [r[0] for r in session.execute(
        text("SELECT industry FROM industries WHERE isactive = 1 AND industry IS NOT NULL AND industry != '' ORDER BY industry")
    ).all()]
    return AccountFilterOptions(industries=industries)


def _build_location(a: Account) -> str | None:
    parts = [p for p in [a.billing_city, a.billing_state, a.country_fws or a.billing_country] if p]
    return ", ".join(parts) if parts else None
