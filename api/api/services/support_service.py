"""Support email: build contextual email body + send via SendGrid."""

import logging
from html import escape

from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Mail
from sqlalchemy import select

import core.config as config
from core.database import get_session
from core.models import Account, Contact, Potential, User

logger = logging.getLogger(__name__)


SUPPORT_CATEGORIES = {
    "agent_stuck": "Agent stuck / not responding",
    "research_quality": "Research data quality",
    "solution_brief": "Solution brief issue",
    "next_action": "Next action / FRE issue",
    "meeting_brief": "Meeting brief issue",
    "email_sending": "Email sending failure",
    "ai_chat": "AI chat issue",
    "call_twilio": "Call / Twilio issue",
    "data_correction": "Data correction needed",
    "other": "Other",
}


def _load_potential_context(potential_id: str) -> dict:
    with get_session() as session:
        row = session.execute(
            select(Potential, Account, Contact, User)
            .outerjoin(Account, Potential.account_id == Account.account_id)
            .outerjoin(Contact, Potential.contact_id == Contact.contact_id)
            .outerjoin(User, Potential.potential_owner_id == User.user_id)
            .where(Potential.potential_id == potential_id)
        ).first()
        if not row:
            return {}
        p, a, c, u = row
        return {
            "potential_id": p.potential_id,
            "potential_number": p.potential_number,
            "deal_name": p.potential_name,
            "stage": p.stage,
            "amount": p.amount,
            "service": p.service,
            "sub_service": p.sub_service,
            "lead_source": p.lead_source,
            "created_time": p.created_time.isoformat() if p.created_time else None,
            "owner_name": u.name if u else None,
            "owner_email": u.email if u else None,
            "company_name": a.account_name if a else None,
            "company_website": a.website if a else None,
            "contact_name": c.full_name if c else None,
            "contact_email": c.email if c else None,
            "contact_phone": c.phone if c else None,
        }


def _row(label: str, value) -> str:
    if value is None or value == "":
        return ""
    return (
        f'<tr><td style="padding:4px 12px 4px 0;color:#64748b;font-size:12px;">{escape(label)}</td>'
        f'<td style="padding:4px 0;color:#0f172a;font-size:13px;">{escape(str(value))}</td></tr>'
    )


def _build_email_body(
    category_label: str,
    user_message: str,
    reporter: User,
    ctx: dict,
) -> str:
    potential_rows = "".join([
        _row("Potential #", ctx.get("potential_number")),
        _row("Potential Name", ctx.get("deal_name")),
        _row("Stage", ctx.get("stage")),
        _row("Amount", ctx.get("amount")),
        _row("Service", ctx.get("service")),
        _row("Sub-service", ctx.get("sub_service")),
        _row("Lead Source", ctx.get("lead_source")),
        _row("Created", ctx.get("created_time")),
        _row("Owner", f'{ctx.get("owner_name") or ""} ({ctx.get("owner_email") or ""})'),
    ])
    company_rows = "".join([
        _row("Company", ctx.get("company_name")),
        _row("Website", ctx.get("company_website")),
        _row("Contact", ctx.get("contact_name")),
        _row("Contact Email", ctx.get("contact_email")),
        _row("Contact Phone", ctx.get("contact_phone")),
    ])

    user_msg_html = escape(user_message or "(No additional details provided.)").replace("\n", "<br>")

    return f"""
    <div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#0f172a;">
      <h2 style="margin:0 0 4px;font-size:18px;">Salezilla Support Request</h2>
      <div style="color:#64748b;font-size:13px;margin-bottom:20px;">Category: <strong>{escape(category_label)}</strong></div>

      <div style="background:#f8fafc;border-radius:8px;padding:16px;margin-bottom:16px;border:1px solid #e2e8f0;">
        <div style="font-weight:600;font-size:13px;color:#334155;margin-bottom:8px;">Reported by</div>
        <div style="font-size:13px;">{escape(reporter.name or "")} &lt;{escape(reporter.email or "")}&gt;</div>
      </div>

      <div style="background:#f8fafc;border-radius:8px;padding:16px;margin-bottom:16px;border:1px solid #e2e8f0;">
        <div style="font-weight:600;font-size:13px;color:#334155;margin-bottom:8px;">User Message</div>
        <div style="font-size:13px;line-height:1.6;">{user_msg_html}</div>
      </div>

      <div style="background:#f8fafc;border-radius:8px;padding:16px;margin-bottom:16px;border:1px solid #e2e8f0;">
        <div style="font-weight:600;font-size:13px;color:#334155;margin-bottom:8px;">Potential Details</div>
        <table style="width:100%;border-collapse:collapse;">{potential_rows}</table>
      </div>

      <div style="background:#f8fafc;border-radius:8px;padding:16px;border:1px solid #e2e8f0;">
        <div style="font-weight:600;font-size:13px;color:#334155;margin-bottom:8px;">Company &amp; Contact</div>
        <table style="width:100%;border-collapse:collapse;">{company_rows}</table>
      </div>
    </div>
    """


def send_support_email(
    potential_id: str,
    category: str,
    user_message: str,
    reporter: User,
) -> bool:
    if not config.SENDGRID_API_KEY:
        logger.error("SENDGRID_API_KEY not set — cannot send support email")
        return False
    if not config.SUPPORT_EMAIL_TO:
        logger.error("SUPPORT_EMAIL_TO not configured — cannot send support email")
        return False

    category_label = SUPPORT_CATEGORIES.get(category, category)
    ctx = _load_potential_context(potential_id)

    subject_deal = ctx.get("potential_number") or ctx.get("deal_name") or potential_id
    subject = f"[Salezilla Support] {category_label} — #{subject_deal}"

    html_body = _build_email_body(category_label, user_message, reporter, ctx)

    message = Mail(
        from_email=config.SENDGRID_FROM_EMAIL,
        to_emails=config.SUPPORT_EMAIL_TO,
        subject=subject,
        html_content=html_body,
    )
    try:
        sg = SendGridAPIClient(config.SENDGRID_API_KEY)
        resp = sg.send(message)
        logger.info("Support email sent to %s — status %s", config.SUPPORT_EMAIL_TO, resp.status_code)
        return resp.status_code in (200, 201, 202)
    except Exception as exc:
        logger.error("Failed to send support email for potential=%s: %s", potential_id, exc)
        return False
