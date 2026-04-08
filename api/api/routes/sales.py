"""Sales targets vs actuals route — MONTHLY periods."""

from datetime import date
from fastapi import APIRouter, Depends
from sqlalchemy import select, text

from core.auth import get_current_active_user
from core.database import get_session
from core.exceptions import BotApiException
from core.models import CXUserToken, User
from core.schemas import ResponseModel, SalesTargetSummary, SalesTopDeal

router = APIRouter(prefix="/sales", tags=["sales"])


# ── Period helpers (month-based) ──────────────────────────────────────────────

def _month_bounds(d: date) -> tuple[date, date]:
    """Return (start, end) for the calendar month containing d. end is exclusive."""
    start = date(d.year, d.month, 1)
    if d.month == 12:
        end = date(d.year + 1, 1, 1)
    else:
        end = date(d.year, d.month + 1, 1)
    return start, end


def _prev_month_bounds(d: date) -> tuple[date, date]:
    if d.month == 1:
        start = date(d.year - 1, 12, 1)
        end = date(d.year, 1, 1)
    else:
        start = date(d.year, d.month - 1, 1)
        end = date(d.year, d.month, 1)
    return start, end


def _month_label(start: date) -> str:
    return start.strftime("%B %Y")  # e.g. "April 2026"


# ── Queries ───────────────────────────────────────────────────────────────────

def _fetch_summary(email: str, m_start: date, m_end: date) -> tuple[float, float]:
    """Return (actuals, target) for the given date range and email.

    actuals = SUM(Invoiceamount) for the period
    target  = SUM(targetsamount) for the period (one row per (account, day) so
              direct sum is correct)
    """
    with get_session() as session:
        row = session.execute(
            text("""
                SELECT
                    COALESCE(SUM(Invoiceamount), 0) AS actuals,
                    COALESCE(SUM(targetsamount), 0) AS target
                FROM VW_actuals_vs_targets_salescopilot
                WHERE Email = :email
                  AND Accountingmonth >= :start
                  AND Accountingmonth < :end
            """),
            {"email": email, "start": m_start, "end": m_end},
        ).fetchone()
        return float(row.actuals or 0), float(row.target or 0)


def _fetch_top_closed_companies(
    email: str, m_start: date, m_end: date, limit: int = 10
) -> list[SalesTopDeal]:
    """Return top N customers by total invoiced amount for the period."""
    with get_session() as session:
        rows = session.execute(
            text("""
                SELECT TOP (:limit)
                    CustomerName,
                    SUM(Invoiceamount) AS company_total
                FROM VW_actuals_vs_targets_salescopilot
                WHERE Email = :email
                  AND Accountingmonth >= :start
                  AND Accountingmonth < :end
                  AND CustomerName IS NOT NULL
                  AND Invoiceamount > 0
                GROUP BY CustomerName
                ORDER BY company_total DESC
            """),
            {"email": email, "start": m_start, "end": m_end, "limit": limit},
        ).fetchall()
        return [
            SalesTopDeal(
                company_name=r.CustomerName,
                amount=float(r.company_total or 0),
            )
            for r in rows
        ]


# ── User → email resolution ──────────────────────────────────────────────────

def _resolve_email(user: User) -> str | None:
    """The view's Email column may differ from the login email.
    Try ms_email (from CXUserToken) first, fall back to login email.
    """
    candidates = [user.email]

    with get_session() as session:
        token = session.execute(
            select(CXUserToken).where(
                CXUserToken.user_id == user.user_id,
                CXUserToken.ms_email != None,  # noqa: E711
                CXUserToken.is_active == True,
            )
        ).scalar_one_or_none()
        if token and token.ms_email and token.ms_email not in candidates:
            candidates.insert(0, token.ms_email)

        for email in candidates:
            count = session.execute(
                text("SELECT COUNT(1) FROM VW_actuals_vs_targets_salescopilot WHERE Email = :email"),
                {"email": email},
            ).scalar()
            if count and count > 0:
                return email
    return None


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.get("/targets/summary", response_model=ResponseModel[SalesTargetSummary])
def get_targets_summary(current_user: User = Depends(get_current_active_user)):
    email = _resolve_email(current_user)
    if not email:
        raise BotApiException(404, "ERR_NO_TARGET_DATA", "No target data found for this user.")

    today = date.today()
    m_start, m_end = _month_bounds(today)
    pm_start, pm_end = _prev_month_bounds(today)

    actuals, target = _fetch_summary(email, m_start, m_end)
    prev_actuals, prev_target = _fetch_summary(email, pm_start, pm_end)
    top_closed = _fetch_top_closed_companies(email, m_start, m_end)

    pct_of_target = (actuals / target * 100) if target > 0 else 0.0
    prev_pct_of_target = (prev_actuals / prev_target * 100) if prev_target > 0 else 0.0
    pct_change = ((actuals - prev_actuals) / prev_actuals * 100) if prev_actuals > 0 else 0.0

    return ResponseModel(data=SalesTargetSummary(
        period_label=_month_label(m_start),
        actuals=actuals,
        target=target,
        pct_of_target=round(pct_of_target, 1),
        prev_period_label=_month_label(pm_start),
        prev_actuals=prev_actuals,
        prev_target=prev_target,
        prev_pct_of_target=round(prev_pct_of_target, 1),
        pct_change=round(pct_change, 1),
        top_closed=top_closed,
    ))
