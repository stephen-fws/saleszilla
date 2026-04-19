"""Contact endpoints."""

from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_, select

from core.auth import get_current_active_user
from core.database import get_session
from core.exceptions import BotApiException
from core.models import Account, Contact, Potential, User
from core.schemas import AccountDetailContact, ContactSearchItem, ResponseModel, UpdateContactRequest
from api.services.access_control import require_contact_owner

router = APIRouter(prefix="/contacts", tags=["contacts"])


@router.get("")
def search_contacts(
    q: str | None = Query(default=None),
    account_id: str | None = Query(default=None),
    page_size: int = Query(default=20, ge=1, le=100),
    user: User = Depends(get_current_active_user),
) -> ResponseModel[list[ContactSearchItem]]:
    with get_session() as session:
        # Include contacts the user owns directly OR on accounts the user/team
        # owns OR on accounts where the user/team owns a potential
        from api.services.potential_service import get_team_user_ids
        team_ids = get_team_user_ids(user.user_id)
        all_ids = [user.user_id] + team_ids

        # Accounts directly owned by user/team
        direct_account_ids = [r[0] for r in session.execute(
            select(Account.account_id).where(Account.account_owner_id.in_(all_ids))
        ).all()]

        # Accounts where user/team owns a potential
        potential_account_ids = [r[0] for r in session.execute(
            select(Potential.account_id).where(
                Potential.potential_owner_id.in_(all_ids),
                Potential.account_id.isnot(None),
            ).distinct()
        ).all()]

        all_account_ids = list(set(direct_account_ids + potential_account_ids))

        stmt = (
            select(Contact, Account)
            .outerjoin(Account, Contact.account_id == Account.account_id)
            .where(or_(
                Contact.contact_owner_id.in_(all_ids),
                Contact.account_id.in_(all_account_ids) if all_account_ids else False,
            ))
        )
        if account_id:
            stmt = stmt.where(Contact.account_id == account_id)
        if q:
            like = f"%{q}%"
            stmt = stmt.where(
                or_(
                    Contact.full_name.ilike(like),
                    Contact.email.ilike(like),
                )
            )
        stmt = stmt.order_by(Contact.full_name).limit(page_size)
        rows = session.execute(stmt).all()
        items = [
            ContactSearchItem(
                id=c.contact_id,
                name=c.full_name or f"{c.first_name or ''} {c.last_name or ''}".strip() or "Unknown",
                title=c.title,
                email=c.email,
                phone=c.phone,
                account_id=c.account_id,
                account_name=a.account_name if a else None,
            )
            for c, a in rows
        ]
    return ResponseModel(data=items)


@router.patch("/{contact_id}")
def patch_contact(
    contact_id: str,
    data: UpdateContactRequest,
    user: User = Depends(get_current_active_user),
) -> ResponseModel[AccountDetailContact]:
    require_contact_owner(user.user_id, contact_id)
    with get_session() as session:
        contact = session.get(Contact, contact_id)
        if not contact:
            raise BotApiException(404, "ERR_NOT_FOUND", "Contact not found.")

        updates = data.model_dump(exclude_none=True)
        field_map = {
            "name": "full_name",
            "title": "title",
            "email": "email",
            "phone": "phone",
            "mobile": "mobile",
            "department": "department",
        }
        for key, col in field_map.items():
            if key in updates:
                setattr(contact, col, updates[key])
        contact.modified_time = datetime.utcnow()
        session.commit()
        session.refresh(contact)

        return ResponseModel(data=AccountDetailContact(
            id=contact.contact_id,
            name=contact.full_name or f"{contact.first_name or ''} {contact.last_name or ''}".strip(),
            title=contact.title,
            email=contact.email,
            phone=contact.phone,
            mobile=contact.mobile,
            department=contact.department,
        ))
