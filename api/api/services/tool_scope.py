"""Hierarchy-based scoping for global chat CRM query tools.

The global chat dispatcher sets a per-request scope (the calling user's
user_id + full reporting subtree). Every tool reads this scope via
`get_scope()` and constrains its SQL so users only see data owned by
themselves or someone beneath them in the org chart.

Scope value semantics:
  - `None`           → no scoping (not used in the current dispatcher, reserved
                       for admin / test paths).
  - `[]`             → explicitly empty scope — user has no accessible data.
  - `["u1", "u2"…]`  → allowed owner user_ids.
"""

from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from typing import Iterator

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from core.models import Account, Potential


_allowed_owner_ids: ContextVar[list[str] | None] = ContextVar(
    "_allowed_owner_ids", default=None
)


@contextmanager
def set_scope(owner_ids: list[str] | None) -> Iterator[None]:
    """Context manager — installs the given allowed-owner list for the duration
    of the `with` block and restores the previous value on exit.

    We deliberately avoid `ContextVar.reset(token)` because Starlette's streaming
    response iterates the generator via anyio's threadpool — each `next(iterator)`
    can run in a different Context, and tokens are only valid in the Context
    where they were created. Instead we snapshot the old value and `set()` it
    back at exit, which works across contexts.
    """
    previous = _allowed_owner_ids.get()
    _allowed_owner_ids.set(owner_ids)
    try:
        yield
    finally:
        _allowed_owner_ids.set(previous)


def get_scope() -> list[str] | None:
    """Return the active allowed-owner list, or None if no scope is set."""
    return _allowed_owner_ids.get()


def potential_owner_clause():
    """Return a SQLAlchemy clause to filter `Potential` rows by the active scope,
    or None when scoping is disabled. Empty scope returns a tautologically false
    clause so no rows match."""
    scope = get_scope()
    if scope is None:
        return None
    if not scope:
        return Potential.potential_id == "__NO_ACCESS__"  # no rows match
    return Potential.potential_owner_id.in_(scope)


def accessible_account_ids_subquery():
    """Subquery of account_ids the current scope can access:
       (accounts directly owned by scope) UNION (accounts with a potential owned by scope).

    Returns None when scope is disabled (caller should skip the filter).
    """
    scope = get_scope()
    if scope is None:
        return None
    if not scope:
        return select(Account.account_id).where(Account.account_id == "__NO_ACCESS__")
    direct = select(Account.account_id).where(Account.account_owner_id.in_(scope))
    via_potential = (
        select(Potential.account_id)
        .where(Potential.potential_owner_id.in_(scope), Potential.account_id.isnot(None))
        .distinct()
    )
    return direct.union(via_potential)


def is_potential_accessible(session: Session, potential: Potential) -> bool:
    """Check if a single Potential row is in the current scope. Returns True when
    no scope is set."""
    scope = get_scope()
    if scope is None:
        return True
    return potential.potential_owner_id in scope


def is_account_accessible(session: Session, account: Account) -> bool:
    """Check if a single Account is accessible: directly owned by scope, or
    scope owns a potential on it. Returns True when no scope is set."""
    scope = get_scope()
    if scope is None:
        return True
    if not scope:
        return False
    if account.account_owner_id in scope:
        return True
    hit = session.execute(
        select(Potential.potential_id).where(
            Potential.account_id == account.account_id,
            Potential.potential_owner_id.in_(scope),
        ).limit(1)
    ).scalar_one_or_none()
    return hit is not None


def is_contact_accessible(session: Session, contact) -> bool:
    """A contact is accessible when directly owned by scope, OR sits on an
    accessible account. Returns True when no scope is set."""
    scope = get_scope()
    if scope is None:
        return True
    if not scope:
        return False
    if contact.contact_owner_id in scope:
        return True
    if contact.account_id:
        account = session.get(Account, contact.account_id)
        if account and is_account_accessible(session, account):
            return True
    return False
