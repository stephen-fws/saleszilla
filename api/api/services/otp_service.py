"""OTP generation, sending via SendGrid, and verification."""

import logging
import random
import string
from datetime import datetime, timedelta, timezone

from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Mail
from sqlalchemy import select

import core.config as config
from core.database import get_session
from core.models import CXOTPCode

logger = logging.getLogger(__name__)


def _generate_otp(length: int = config.OTP_LENGTH) -> str:
    return "".join(random.choices(string.digits, k=length))


def create_otp(user_id: str) -> CXOTPCode:
    """Invalidate existing OTPs and create a fresh one."""
    now = datetime.now(timezone.utc)
    with get_session() as session:
        # Invalidate existing active OTPs for this user
        stmt = select(CXOTPCode).where(
            CXOTPCode.user_id == user_id,
            CXOTPCode.is_active == True,
            CXOTPCode.is_used == False,
        )
        for existing in session.execute(stmt).scalars().all():
            existing.is_active = False
            existing.updated_time = now
            session.add(existing)

        # Create new OTP
        otp = CXOTPCode(
            user_id=user_id,
            code=_generate_otp(),
            expires_at=now + timedelta(minutes=config.OTP_EXPIRE_MINUTES),
            is_used=False,
            created_time=now,
            updated_time=now,
            is_active=True,
        )
        session.add(otp)
        session.flush()
        session.refresh(otp)
        session.expunge(otp)
    return otp


def verify_otp(user_id: str, code: str) -> bool:
    """Verify OTP code. Returns True if valid, marks as used."""
    now = datetime.now(timezone.utc)
    with get_session() as session:
        stmt = select(CXOTPCode).where(
            CXOTPCode.user_id == user_id,
            CXOTPCode.code == code,
            CXOTPCode.is_active == True,
            CXOTPCode.is_used == False,
        ).order_by(CXOTPCode.created_time.desc())

        otp = session.execute(stmt).scalar_one_or_none()
        if not otp:
            return False

        # Check expiry (SQL Server DATETIME is naive, so strip tzinfo for comparison)
        expires_at = otp.expires_at.replace(tzinfo=timezone.utc) if otp.expires_at.tzinfo is None else otp.expires_at
        if expires_at < now:
            otp.is_active = False
            otp.updated_time = now
            session.add(otp)
            return False

        # Mark as used
        otp.is_used = True
        otp.is_active = False
        otp.updated_time = now
        session.add(otp)
    return True


def send_otp_email(email: str, code: str) -> bool:
    """Send OTP code via SendGrid."""
    if not config.SENDGRID_API_KEY:
        logger.warning("SENDGRID_API_KEY not set — logging OTP to console: %s", code)
        return True

    message = Mail(
        from_email=config.SENDGRID_FROM_EMAIL,
        to_emails=email,
        subject="Your Salezilla Login Code",
        html_content=_build_otp_email(code),
    )

    try:
        sg = SendGridAPIClient(config.SENDGRID_API_KEY)
        response = sg.send(message)
        logger.info("OTP email sent to %s — status %s", email, response.status_code)
        return response.status_code in (200, 201, 202)
    except Exception as exc:
        logger.error("Failed to send OTP email to %s: %s", email, exc)
        return False


def _build_otp_email(code: str) -> str:
    return f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        <h2 style="color: #1a1a2e; margin-bottom: 8px;">Your Login Code</h2>
        <p style="color: #666; margin-bottom: 24px;">Enter this code to sign in to Salezilla:</p>
        <div style="background: #f0f4ff; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 24px;">
            <span style="font-size: 36px; font-weight: 700; letter-spacing: 8px; color: #1a1a2e;">{code}</span>
        </div>
        <p style="color: #999; font-size: 13px;">This code expires in {config.OTP_EXPIRE_MINUTES} minutes. If you didn't request this, you can safely ignore this email.</p>
    </div>
    """
