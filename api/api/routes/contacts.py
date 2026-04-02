"""Contact endpoints."""

from datetime import datetime

from fastapi import APIRouter, Depends

from core.auth import get_current_active_user
from core.database import get_session
from core.exceptions import BotApiException
from core.models import Contact, User
from core.schemas import AccountDetailContact, ResponseModel, UpdateContactRequest

router = APIRouter(prefix="/contacts", tags=["contacts"])


@router.patch("/{contact_id}")
def patch_contact(
    contact_id: str,
    data: UpdateContactRequest,
    user: User = Depends(get_current_active_user),
) -> ResponseModel[AccountDetailContact]:
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
