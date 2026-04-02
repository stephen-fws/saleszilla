"""JWT creation, validation, and FastAPI authentication dependencies."""

import logging
from datetime import datetime, timedelta, timezone
from typing import Annotated, Optional

import jwt
from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

import core.config as config
from core.exceptions import BotApiException
from core.models import User

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
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer_scheme)] = None,
) -> User:
    """Validate access token and return the authenticated User."""
    token = credentials.credentials if credentials else None
    if not token:
        raise BotApiException(401, "ERR_CREDENTIALS_INVALID", "No authentication token provided.")

    # Import here to avoid circular dependency
    from api.services.user_service import load_user_by_id

    user_id = _decode_access_token(token)
    user = load_user_by_id(user_id)
    if not user:
        raise BotApiException(401, "ERR_CREDENTIALS_INVALID", "User not found.")
    return user


def get_current_active_user(user: User = Depends(get_current_user)) -> User:
    """Ensure the authenticated user is active."""
    if not user.is_active:
        raise BotApiException(403, "ERR_USER_DISABLED", "Your account has been deactivated.")
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
