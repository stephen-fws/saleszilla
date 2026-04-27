"""User + token loading and persistence."""

import logging
from datetime import datetime, timezone

from sqlalchemy import select

from core.database import get_session
from core.models import CXUserToken, User
from core.schemas import UserInfo

logger = logging.getLogger(__name__)


# ── User queries (read-only on existing `users` table) ───────────────────────


def load_user_by_id(user_id: str) -> User | None:
    """Load a user by their Zoho CRM User Id."""
    with get_session() as session:
        user = session.get(User, user_id)
        if user:
            session.expunge(user)
        return user


def load_user_by_email(email: str) -> User | None:
    """Load an active user by email (case-insensitive)."""
    with get_session() as session:
        stmt = select(User).where(
            User.email == email.strip(),
            User.is_active == True,
        )
        user = session.execute(stmt).scalar_one_or_none()
        if user:
            session.expunge(user)
        return user


# ── Token queries (read-write on CX_UserTokens) ─────────────────────────────


def load_user_tokens(user_id: str, provider: str = "microsoft") -> CXUserToken | None:
    """Load MS token record for a user."""
    with get_session() as session:
        stmt = select(CXUserToken).where(
            CXUserToken.user_id == user_id,
            CXUserToken.provider == provider,
            CXUserToken.is_active == True,
        )
        token = session.execute(stmt).scalar_one_or_none()
        if token:
            session.expunge(token)
        return token


def save_user_ms_tokens(
    user_id: str,
    ms_email: str,
    access_token: str,
    refresh_token: str,
    expires_at: datetime,
) -> CXUserToken:
    """Upsert Microsoft tokens into CX_UserTokens."""
    now = datetime.now(timezone.utc)
    with get_session() as session:
        stmt = select(CXUserToken).where(
            CXUserToken.user_id == user_id,
            CXUserToken.provider == "microsoft",
        )
        existing = session.execute(stmt).scalar_one_or_none()

        if existing:
            existing.ms_email = ms_email
            existing.access_token = access_token
            existing.refresh_token = refresh_token
            existing.token_expiry = expires_at
            existing.updated_time = now
            existing.is_active = True
            session.add(existing)
            session.flush()
            session.refresh(existing)
            session.expunge(existing)
            return existing
        else:
            token_row = CXUserToken(
                user_id=user_id,
                provider="microsoft",
                access_token=access_token,
                refresh_token=refresh_token,
                token_expiry=expires_at,
                created_time=now,
                updated_time=now,
                is_active=True,
            )
            session.add(token_row)
            session.flush()
            session.refresh(token_row)
            session.expunge(token_row)
            return token_row


def clear_user_ms_tokens(user_id: str) -> None:
    """Soft-deactivate Microsoft tokens for a user."""
    now = datetime.now(timezone.utc)
    with get_session() as session:
        stmt = select(CXUserToken).where(
            CXUserToken.user_id == user_id,
            CXUserToken.provider == "microsoft",
        )
        token = session.execute(stmt).scalar_one_or_none()
        if token:
            token.access_token = None
            token.refresh_token = None
            token.token_expiry = None
            token.is_active = False
            token.updated_time = now
            session.add(token)


# ── Composite queries ────────────────────────────────────────────────────────


def is_super_admin(user_id: str) -> bool:
    """Whether this user is a superadmin (CX_UserTokens.IsSuperAdmin = 1)."""
    tokens = load_user_tokens(user_id)
    return bool(tokens and tokens.is_active and tokens.is_super_admin)


def list_active_users() -> list[User]:
    """All active users — feeds the superadmin impersonation dropdown."""
    with get_session() as session:
        rows = session.execute(
            select(User).where(User.is_active == True).order_by(User.name)
        ).scalars().all()
        for u in rows:
            session.expunge(u)
        return list(rows)


def get_user_info(user_id: str) -> UserInfo | None:
    """Load User + CX_UserTokens and compose a UserInfo response."""
    user = load_user_by_id(user_id)
    if not user:
        return None

    tokens = load_user_tokens(user_id)
    is_connected = bool(
        tokens
        and tokens.access_token
        and tokens.is_active
    )

    return UserInfo(
        id=user.user_id,
        email=user.email,
        name=user.name,
        role=user.role,
        is_active=user.is_active,
        is_ms_connected=is_connected,
        ms_email=tokens.ms_email if tokens else None,
        is_super_admin=bool(tokens and tokens.is_super_admin),
    )
