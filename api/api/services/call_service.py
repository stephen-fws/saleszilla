"""Call log operations."""

from datetime import datetime, timezone

from sqlalchemy import select

from core.database import get_session
from core.models import CXCallLog, CXActivity
from core.schemas import CallLogItem


def list_calls(potential_id: str) -> list[CallLogItem]:
    with get_session() as session:
        stmt = select(CXCallLog).where(
            CXCallLog.potential_id == potential_id,
            CXCallLog.is_active == True,
        ).order_by(CXCallLog.created_time.desc())
        return [
            CallLogItem(id=c.id, potential_id=c.potential_id, contact_name=c.contact_name,
                        phone_number=c.phone_number, duration=c.duration, status=c.status,
                        notes=c.notes, created_time=c.created_time)
            for c in session.execute(stmt).scalars().all()
        ]


def create_call(
    potential_id: str,
    phone_number: str | None,
    contact_name: str | None,
    duration: int,
    status: str,
    notes: str | None,
    contact_id: str | None,
    account_id: str | None,
    user_id: str | None = None,
) -> CallLogItem:
    now = datetime.now(timezone.utc)
    with get_session() as session:
        call = CXCallLog(
            potential_id=potential_id, phone_number=phone_number, contact_name=contact_name,
            duration=duration, status=status, notes=notes,
            contact_id=contact_id, account_id=account_id,
            called_by_user_id=user_id, created_time=now, updated_time=now, is_active=True,
        )
        session.add(call)

        # Log activity
        mins, secs = divmod(duration, 60)
        desc = f"Call with {contact_name or 'Unknown'} — {mins}:{secs:02d}"
        if notes:
            desc += f" — {notes[:100]}"

        activity = CXActivity(
            potential_id=potential_id, contact_id=contact_id, account_id=account_id,
            activity_type="call", description=desc,
            performed_by_user_id=user_id, created_time=now, updated_time=now, is_active=True,
        )
        session.add(activity)

        session.flush()
        session.refresh(call)
        return CallLogItem(id=call.id, potential_id=call.potential_id, contact_name=call.contact_name,
                           phone_number=call.phone_number, duration=call.duration, status=call.status,
                           notes=call.notes, created_time=call.created_time)
