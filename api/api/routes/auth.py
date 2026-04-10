"""Authentication routes — OTP login, SSO via Microsoft, token refresh, user info."""

import json
import logging
from urllib.parse import urlencode, quote

from fastapi import APIRouter, Body, Depends, Query, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

import core.config as config
from core.auth import (
    create_access_token,
    create_refresh_token,
    get_current_active_user,
    get_refresh_user,
)
from core.exceptions import BotApiException
from core.models import User
from core.ms_graph import (
    exchange_code_for_tokens,
    get_ms_user_profile,
    tokens_expire_at,
    get_authorization_url,
)
from core.schemas import (
    AccessTokenResponse,
    LoginTokens,
    MicrosoftConnectResponse,
    ResponseModel,
    UserInfo,
)
from api.services.user_service import (
    clear_user_ms_tokens,
    get_user_info,
    load_user_by_email,
    save_user_ms_tokens,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["authentication"])


# ── OTP Login ────────────────────────────────────────────────────────────────


class OTPRequest(BaseModel):
    email: str


class OTPVerify(BaseModel):
    email: str
    code: str


@router.post("/otp/send")
def send_otp(data: OTPRequest = Body()):
    """
    Send a one-time login code to the user's email via SendGrid.
    Email must match an existing active user in the CRM.
    """
    from api.services.otp_service import create_otp, send_otp_email

    email = data.email.strip().lower()

    # Restrict OTP to allowed domains
    ALLOWED_DOMAINS = ("@flatworldsolutions.com", "@botworkflat.onmicrosoft.com")
    if not any(email.endswith(d) for d in ALLOWED_DOMAINS):
        raise BotApiException(400, "ERR_INVALID_DOMAIN", "OTP login is only available for @flatworldsolutions.com or @botworkflat.onmicrosoft.com emails.")

    user = load_user_by_email(email)
    if not user:
        raise BotApiException(404, "ERR_USER_NOT_FOUND", "No account found for this email.")
    if not user.is_active:
        raise BotApiException(403, "ERR_USER_DISABLED", "Your account has been deactivated.")

    otp = create_otp(user.user_id)
    sent = send_otp_email(email, otp.code)
    if not sent:
        raise BotApiException(500, "ERR_EMAIL_FAILED", "Failed to send login code. Please try again.")

    return ResponseModel(
        message_code="MSG_OTP_SENT",
        message="Login code sent to your email.",
        data={"email": email},
    )


@router.post("/otp/verify")
def verify_otp(data: OTPVerify = Body()) -> ResponseModel[LoginTokens]:
    """
    Verify the OTP code and return JWT tokens.
    """
    from api.services.otp_service import verify_otp as verify_otp_code

    email = data.email.strip().lower()
    user = load_user_by_email(email)
    if not user:
        raise BotApiException(404, "ERR_USER_NOT_FOUND", "No account found for this email.")

    if not verify_otp_code(user.user_id, data.code):
        raise BotApiException(401, "ERR_INVALID_OTP", "Invalid or expired code.")

    access_token = create_access_token(user.user_id)
    refresh_token = create_refresh_token(user.user_id)

    return ResponseModel(
        message_code="MSG_LOGIN_SUCCESS",
        data=LoginTokens(access_token=access_token, refresh_token=refresh_token),
    )


# ── SSO Login (initiate) ─────────────────────────────────────────────────────


@router.get("/sso/connect")
async def sso_connect(
    request: Request,
    callback_url: str = Query(..., description="Frontend URL to redirect after SSO"),
    nonce: str = Query(default="", description="CSRF nonce from frontend"),
):
    """
    Initiate Microsoft SSO login.

    This is the login entry point — no JWT required.
    Redirects the browser to Microsoft's OAuth2 login page.
    After consent, Microsoft redirects back to /auth/sso/callback.
    """
    redirect_uri = str(request.url_for("sso_callback")).replace("http://", "https://")

    state = json.dumps({
        "callback_url": callback_url,
        "nonce": nonce,
    })

    auth_url = get_authorization_url(redirect_uri=redirect_uri, state=state)
    return RedirectResponse(url=auth_url)


# ── SSO Callback ─────────────────────────────────────────────────────────────


@router.get("/sso/callback", name="sso_callback", include_in_schema=False)
async def sso_callback(
    request: Request,
    code: str | None = Query(default=None),
    state: str | None = Query(default=None),
    error: str | None = Query(default=None),
    error_description: str | None = Query(default=None),
):
    """
    Handle Microsoft OAuth2 callback.

    Steps:
      1. Exchange code for MS tokens
      2. Fetch MS profile to get email
      3. Match email to existing user in `users` table
      4. Persist MS tokens in CX_UserTokens
      5. Issue JWT tokens (access + refresh)
      6. Redirect to frontend callback_url with tokens
    """
    # Parse state
    try:
        state_data = json.loads(state) if state else {}
    except (json.JSONDecodeError, TypeError):
        state_data = {}

    callback_url = state_data.get("callback_url", config.FRONTEND_URL)
    nonce = state_data.get("nonce", "")

    # Handle MS error
    if error:
        logger.error("SSO error: %s — %s", error, error_description)
        params = urlencode({
            "nonce": nonce,
            "error": error,
            "error_description": error_description or "Authentication failed.",
        })
        return RedirectResponse(url=f"{callback_url}?{params}")

    if not code:
        params = urlencode({
            "nonce": nonce,
            "error": "no_code",
            "error_description": "No authorization code received from Microsoft.",
        })
        return RedirectResponse(url=f"{callback_url}?{params}")

    try:
        # Step 1: Exchange code for tokens
        redirect_uri = str(request.url_for("sso_callback")).replace("http://", "https://")
        token_data = await exchange_code_for_tokens(code, redirect_uri)

        ms_access_token = token_data["access_token"]
        ms_refresh_token = token_data.get("refresh_token", "")
        expires_in = int(token_data.get("expires_in", 3600))

        # Step 2: Fetch MS profile
        profile = await get_ms_user_profile(ms_access_token)
        ms_email = (
            profile.get("mail")
            or profile.get("userPrincipalName")
            or ""
        ).strip().lower()

        if not ms_email:
            raise BotApiException(400, "ERR_NO_EMAIL", "Could not retrieve email from Microsoft profile.")

        # Step 3: Match to existing user
        user = load_user_by_email(ms_email)
        if not user:
            logger.warning("SSO login failed: no user found for email %s", ms_email)
            params = urlencode({
                "nonce": nonce,
                "error": "user_not_found",
                "error_description": f"No account found for {ms_email}. Contact your administrator.",
            })
            return RedirectResponse(url=f"{callback_url}?{params}")

        # Step 4: Persist MS tokens
        save_user_ms_tokens(
            user_id=user.user_id,
            ms_email=ms_email,
            access_token=ms_access_token,
            refresh_token=ms_refresh_token,
            expires_at=tokens_expire_at(expires_in),
        )

        # Step 5: Issue JWT tokens
        access_token = create_access_token(user.user_id)
        refresh_token = create_refresh_token(user.user_id)

        # Step 6: Redirect to frontend
        response_data = json.dumps({
            "status": "OK",
            "access_token": access_token,
            "refresh_token": refresh_token,
            "ms_email": ms_email,
        })
        params = urlencode({"nonce": nonce, "response": response_data})
        return RedirectResponse(url=f"{callback_url}?{params}")

    except BotApiException:
        raise
    except Exception as exc:
        logger.exception("SSO callback failed: %s", exc)
        params = urlencode({
            "nonce": nonce,
            "error": "callback_failed",
            "error_description": "Authentication failed. Please try again.",
        })
        return RedirectResponse(url=f"{callback_url}?{params}")


# ── Disconnect Microsoft ─────────────────────────────────────────────────────


@router.delete("/sso/disconnect")
async def sso_disconnect(
    user: User = Depends(get_current_active_user),
) -> ResponseModel[MicrosoftConnectResponse]:
    """Revoke the connected Microsoft account tokens."""
    from api.services.user_service import load_user_tokens

    tokens = load_user_tokens(user.user_id)
    if not tokens or not tokens.access_token:
        raise BotApiException(400, "ERR_NOT_CONNECTED", "No Microsoft account is connected.")

    ms_email = tokens.ms_email or ""
    clear_user_ms_tokens(user.user_id)

    return ResponseModel(
        message_code="MSG_DISCONNECTED",
        message="Microsoft account disconnected.",
        data=MicrosoftConnectResponse(
            ms_email=ms_email,
            message="Microsoft account disconnected successfully.",
        ),
    )


# ── Token refresh ────────────────────────────────────────────────────────────


@router.get("/refresh")
async def refresh_token(
    user: User = Depends(get_refresh_user),
) -> ResponseModel[AccessTokenResponse]:
    """Exchange a valid refresh token for a new access token."""
    new_access_token = create_access_token(user.user_id)
    return ResponseModel(
        message_code="MSG_TOKEN_REFRESHED",
        data=AccessTokenResponse(access_token=new_access_token),
    )


# ── Current user info ────────────────────────────────────────────────────────


@router.get("/me")
async def get_me(
    user: User = Depends(get_current_active_user),
) -> ResponseModel[UserInfo]:
    """Return authenticated user info including MS connection status."""
    user_info = get_user_info(user.user_id)
    if not user_info:
        raise BotApiException(404, "ERR_USER_NOT_FOUND", "User not found.")
    return ResponseModel(data=user_info)
