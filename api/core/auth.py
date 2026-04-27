"""JWT creation, validation, and FastAPI authentication dependencies."""

import logging
from datetime import datetime, timedelta, timezone
from typing import Annotated, Optional

import jwt
from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

import core.config as config
from core.exceptions import BotApiException
from core.models import User


# Header that lets a superadmin impersonate another user. Set by the UI's
# protectedApi axios instance whenever the admin has picked a user from the
# top-bar dropdown. Non-superadmins sending it are rejected.
IMPERSONATE_HEADER = "X-Impersonate-User-Id"


def is_impersonating(user: User) -> bool:
    """Whether the current request is a superadmin viewing as another user.
    Routes that hit MS Graph (calendar, meeting briefs, mail) use this to
    swallow `424 ERR_MICROSOFT_NOT_CONNECTED` and return empty data — the
    target user may not have connected MS, but that's not an error in
    impersonation mode.
    """
    return bool(getattr(user, "impersonated_by", None))

logger = logging.getLogger(__name__)


# ── Bearer token scheme ───────────────────────────────────────────────────────

_bearer_scheme = HTTPBearer(scheme_name="Salezilla JWT", auto_error=False)


# ── Token creation ───────────────────────────────────────────────────────────


def create_access_token(subject_id: str, expires_minutes: int | None = None) -> str:
    """Create a JWT access token with sub=user_id."""
    expires_delta = timedelta(minutes=expires_minutes or config.JWT_ACCESS_TOKEN_EXPIRE_MINUTES)
    expire = datetime.now(timezone.utc) + expires_delta
    payload = {"sub": subject_id, "exp": expire}
    return jwt.encode(payload, config.JWT_ACCESS_SECRET_KEY, algorithm=config.JWT_ALGORITHM)


def create_refresh_token(subject_id: str, expires_minutes: int | None = None) -> str:
    """Create a JWT refresh token with sub=user_id and type=refresh."""
    expires_delta = timedelta(minutes=expires_minutes or config.JWT_REFRESH_TOKEN_EXPIRE_MINUTES)
    expire = datetime.now(timezone.utc) + expires_delta
    payload = {"sub": subject_id, "exp": expire, "type": "refresh"}
    return jwt.encode(payload, config.JWT_REFRESH_SECRET_KEY, algorithm=config.JWT_ALGORITHM)


# ── Token decoding ───────────────────────────────────────────────────────────


def _decode_access_token(token: str) -> str:
    """Decode and validate an access token. Returns user_id (sub claim)."""
    try:
        payload = jwt.decode(token, config.JWT_ACCESS_SECRET_KEY, algorithms=[config.JWT_ALGORITHM])
        user_id: str | None = payload.get("sub")
        if not user_id:
            raise BotApiException(401, "ERR_CREDENTIALS_INVALID", "Invalid token subject.")
        return user_id
    except jwt.ExpiredSignatureError:
        raise BotApiException(401, "ERR_TOKEN_EXPIRED", "Access token has expired.")
    except jwt.PyJWTError:
        raise BotApiException(401, "ERR_CREDENTIALS_INVALID", "Invalid access token.")


def _decode_refresh_token(token: str) -> str:
    """Decode and validate a refresh token. Returns user_id (sub claim)."""
    try:
        payload = jwt.decode(token, config.JWT_REFRESH_SECRET_KEY, algorithms=[config.JWT_ALGORITHM])
        user_id: str | None = payload.get("sub")
        if not user_id:
            raise BotApiException(401, "ERR_CREDENTIALS_INVALID", "Invalid refresh token subject.")
        return user_id
    except jwt.ExpiredSignatureError:
        raise BotApiException(401, "ERR_TOKEN_EXPIRED", "Refresh token has expired.")
    except jwt.PyJWTError:
        raise BotApiException(401, "ERR_CREDENTIALS_INVALID", "Invalid refresh token.")


# ── FastAPI dependencies ─────────────────────────────────────────────────────


def get_current_user(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer_scheme)] = None,
) -> User:
    """Validate access token and return the authenticated User.

    If `X-Impersonate-User-Id` is set AND the authenticated user is a
    superadmin, returns the impersonated user instead — with two runtime
    attributes attached:
      - `impersonated_by`: the original superadmin's user_id
      - `is_super_admin`: copied from the original (so UI/middleware know)

    The mutation-guard middleware blocks writes whenever `impersonated_by` is
    set, so impersonation is hard-read-only.
    """
    token = credentials.credentials if credentials else None
    if not token:
        raise BotApiException(401, "ERR_CREDENTIALS_INVALID", "No authentication token provided.")

    # Import here to avoid circular dependency
    from api.services.user_service import load_user_by_id, is_super_admin

    user_id = _decode_access_token(token)
    user = load_user_by_id(user_id)
    if not user:
        raise BotApiException(401, "ERR_CREDENTIALS_INVALID", "User not found.")

    # Mark the user with their superadmin status so downstream code can check
    # without a second DB lookup.
    user.is_super_admin = is_super_admin(user_id)  # type: ignore[attr-defined]
    user.impersonated_by = None  # type: ignore[attr-defined]

    impersonate_id = request.headers.get(IMPERSONATE_HEADER)
    if impersonate_id:
        if not user.is_super_admin:  # type: ignore[attr-defined]
            raise BotApiException(
                403, "ERR_IMPERSONATION_FORBIDDEN",
                "Only superadmins can impersonate other users.",
            )
        target = load_user_by_id(impersonate_id)
        if not target:
            raise BotApiException(404, "ERR_IMPERSONATE_TARGET_NOT_FOUND", "Impersonation target not found.")
        # Carry the audit trail forward on the swapped-in user object.
        target.is_super_admin = True  # type: ignore[attr-defined]
        target.impersonated_by = user.user_id  # type: ignore[attr-defined]
        return target

    return user


_MUTATING_METHODS = {"POST", "PATCH", "PUT", "DELETE"}


def get_current_active_user(
    request: Request,
    user: User = Depends(get_current_user),
) -> User:
    """Ensure the authenticated user is active.

    Also enforces the impersonation read-only rule: when a superadmin is
    viewing as another user (`impersonated_by` set), every mutation verb is
    rejected here. Centralised so every route using this dep is covered;
    webhooks and scheduler ticks (API-key-gated) bypass and remain writable.
    """
    if not user.is_active:
        raise BotApiException(403, "ERR_USER_DISABLED", "Your account has been deactivated.")
    if (
        getattr(user, "impersonated_by", None)
        and request.method.upper() in _MUTATING_METHODS
    ):
        raise BotApiException(
            403,
            "ERR_IMPERSONATION_READ_ONLY",
            "You're viewing as another user — actions are disabled. Switch back to your own account to make changes.",
        )
    return user


def get_refresh_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer_scheme)] = None,
) -> User:
    """Validate refresh token and return the User."""
    token = credentials.credentials if credentials else None
    if not token:
        raise BotApiException(401, "ERR_CREDENTIALS_INVALID", "No refresh token provided.")

    from api.services.user_service import load_user_by_id

    user_id = _decode_refresh_token(token)
    user = load_user_by_id(user_id)
    if not user:
        raise BotApiException(401, "ERR_CREDENTIALS_INVALID", "User not found.")
    if not user.is_active:
        raise BotApiException(403, "ERR_USER_DISABLED", "Your account has been deactivated.")
    return user
