"""Contact endpoints."""

from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_, select

from core.auth import get_current_active_user
from core.database import get_session
from core.exceptions import BotApiException
from core.models import Account, Contact, User
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
        stmt = (
            select(Contact, Account)
            .outerjoin(Account, Contact.account_id == Account.account_id)
            .where(Contact.contact_owner_id == user.user_id)
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
