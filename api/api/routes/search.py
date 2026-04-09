"""Global search route — potentials, accounts, contacts.

Results include the current user's records + their direct reports' records
(users whose reporting_to = current user's email). This lets managers find
their team's deals in the same search bar.
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_, select

from core.auth import get_current_active_user
from core.database import get_session
from core.models import Account, Contact, Potential, User
from core.schemas import ResponseModel
from api.services.potential_service import get_team_user_ids
from pydantic import BaseModel
from typing import Optional

router = APIRouter(prefix="/search", tags=["search"])

LIMIT = 5


class SearchPotentialItem(BaseModel):
    id: str
    label: str       # potential name / title
    sublabel: str    # "#0001234 · Company Name"
    potential_number: Optional[str] = None


class SearchAccountItem(BaseModel):
    id: str
    label: str       # account name
    sublabel: str    # industry · location


class SearchContactItem(BaseModel):
    id: str
    label: str       # full name
    sublabel: str    # email · title
    account_id: Optional[str] = None
    potential_id: Optional[str] = None  # fallback if no account


class SearchResults(BaseModel):
    potentials: list[SearchPotentialItem] = []
    accounts: list[SearchAccountItem] = []
    contacts: list[SearchContactItem] = []


@router.get("", response_model=ResponseModel[SearchResults])
def global_search(
    q: str = Query(..., min_length=2, max_length=100),
    current_user: User = Depends(get_current_active_user),
):
    """Global search — returns records owned by the current user + their direct reports."""
    term = f"%{q}%"
    user_id = current_user.user_id
    team_ids = get_team_user_ids(user_id)
    all_owner_ids = [user_id] + team_ids

    with get_session() as session:
        # ── Potentials (owned by user + team) ─────────────────────────────────
        pot_rows = session.execute(
            select(Potential, Account)
            .outerjoin(Account, Potential.account_id == Account.account_id)
            .where(
                Potential.potential_owner_id.in_(all_owner_ids),
                or_(
                    Potential.potential_name.ilike(term),
                    Potential.potential_number.ilike(term),
                ),
            )
            .limit(LIMIT)
        ).all()

        potentials = [
            SearchPotentialItem(
                id=p.potential_id,
                label=p.potential_name or "(Untitled)",
                sublabel=" · ".join(filter(None, [
                    f"#{p.potential_number}" if p.potential_number else None,
                    a.account_name if a else None,
                ])) or "",
                potential_number=p.potential_number,
            )
            for p, a in pot_rows
        ]

        # ── Accounts (owned by user + team) ───────────────────────────────────
        acc_rows = session.execute(
            select(Account)
            .where(
                Account.account_owner_id.in_(all_owner_ids),
                Account.account_name.ilike(term),
            )
            .limit(LIMIT)
        ).scalars().all()

        accounts = [
            SearchAccountItem(
                id=a.account_id,
                label=a.account_name or "(Unnamed)",
                sublabel=" · ".join(filter(None, [a.industry, a.billing_country or a.country_fws])) or "",
            )
            for a in acc_rows
        ]

        # ── Contacts (owned by user + team) ───────────────────────────────────
        con_rows = session.execute(
            select(Contact)
            .where(
                Contact.contact_owner_id.in_(all_owner_ids),
                or_(
                    Contact.full_name.ilike(term),
                    Contact.email.ilike(term),
                ),
            )
            .limit(LIMIT)
        ).scalars().all()

        # For contacts without an account, fetch their latest potential —
        # also restricted to user + team ownership
        contact_ids_no_account = [c.contact_id for c in con_rows if not c.account_id]
        latest_potentials: dict[str, str] = {}
        if contact_ids_no_account:
            pot_fallbacks = session.execute(
                select(Potential.contact_id, Potential.potential_id)
                .where(
                    Potential.contact_id.in_(contact_ids_no_account),
                    Potential.potential_owner_id.in_(all_owner_ids),
                )
                .order_by(Potential.created_time.desc())
            ).all()
            for contact_id, potential_id in pot_fallbacks:
                if contact_id not in latest_potentials:
                    latest_potentials[contact_id] = potential_id

        contacts = [
            SearchContactItem(
                id=c.contact_id,
                label=c.full_name or "(Unknown)",
                sublabel=" · ".join(filter(None, [c.email, c.title])) or "",
                account_id=c.account_id or None,
                potential_id=latest_potentials.get(c.contact_id),
            )
            for c in con_rows
        ]

    return ResponseModel(data=SearchResults(
        potentials=potentials,
        accounts=accounts,
        contacts=contacts,
    ))
