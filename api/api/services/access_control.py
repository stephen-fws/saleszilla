"""Ownership / access-control helpers.

Salezilla policy:
  - UI navigation (search, detail GETs/PATCH) is restricted to records the
    current user OWNS **or** their direct reports own.
  - Aggregate / analytical chat queries (global chat tools) still see all-org
    data — that's a separate code path and not enforced here.

Each helper returns True/False; raise BotApiException 403 in routes when False.
"""

from __future__ import annotations

from sqlalchemy import select

from core.database import get_session
from core.exceptions import BotApiException
from core.models import Account, Contact, Potential


def _get_allowed_owner_ids(user_id: str) -> set[str]:
    """Return the set of user_ids whose records the given user may access:
    themselves + direct reports (users whose reporting_to == user's email).
    Cached per-request via import-time lazy eval."""
    from api.services.potential_service import get_team_user_ids
    return {user_id} | set(get_team_user_ids(user_id))


def user_owns_potential(user_id: str, potential_id: str) -> bool:
    with get_session() as session:
        owner = session.execute(
            select(Potential.potential_owner_id).where(Potential.potential_id == potential_id)
        ).scalar_one_or_none()
    return owner is not None and owner in _get_allowed_owner_ids(user_id)


def user_owns_account(user_id: str, account_id: str) -> bool:
    """A user can access an account if EITHER:
      - They (or a direct report) are the account_owner_id, OR
      - They (or a direct report) own a Potential linked to this account
    The second rule ensures accounts found via the potentials list are also
    accessible in the detail view."""
    allowed = _get_allowed_owner_ids(user_id)
    with get_session() as session:
        # Check direct account ownership
        owner = session.execute(
            select(Account.account_owner_id).where(Account.account_id == account_id)
        ).scalar_one_or_none()
        if owner and owner in allowed:
            return True
        # Check if user/team owns any potential on this account
        has_potential = session.execute(
            select(Potential.potential_id).where(
                Potential.account_id == account_id,
                Potential.potential_owner_id.in_(list(allowed)),
            ).limit(1)
        ).scalar_one_or_none()
        return has_potential is not None


def user_owns_contact(user_id: str, contact_id: str) -> bool:
    """A user can access a contact if EITHER:
      - They (or a direct report) are the contact_owner_id, OR
      - They can access the Account the contact belongs to (via user_owns_account,
        which includes both direct account ownership AND owning a potential on it)
    """
    allowed = _get_allowed_owner_ids(user_id)
    with get_session() as session:
        row = session.execute(
            select(Contact.contact_owner_id, Contact.account_id)
            .where(Contact.contact_id == contact_id)
        ).first()
        if not row:
            return False
        contact_owner_id, account_id = row
        if contact_owner_id in allowed:
            return True
        if account_id:
            return user_owns_account(user_id, account_id)
    return False


# ── Raising versions for routes ──────────────────────────────────────────────

def require_potential_owner(user_id: str, potential_id: str) -> None:
    if not user_owns_potential(user_id, potential_id):
        # 404 (not 403) so we don't leak existence of records the user can't see
        raise BotApiException(404, "ERR_NOT_FOUND", "Potential not found.")


def require_account_owner(user_id: str, account_id: str) -> None:
    if not user_owns_account(user_id, account_id):
        raise BotApiException(404, "ERR_NOT_FOUND", "Account not found.")


def require_contact_owner(user_id: str, contact_id: str) -> None:
    if not user_owns_contact(user_id, contact_id):
        raise BotApiException(404, "ERR_NOT_FOUND", "Contact not found.")
