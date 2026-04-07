"""Sales targets vs actuals route."""

from datetime import date
from fastapi import APIRouter, Depends
from sqlalchemy import select, text

from core.auth import get_current_active_user
from core.database import get_session
from core.models import CXUserToken, User
from core.schemas import ResponseModel, SalesTargetSummary, SalesTopDeal

router = APIRouter(prefix="/sales", tags=["sales"])


def _quarter_bounds(d: date) -> tuple[date, date]:
    """Return (start, end) for the quarter containing d. end is exclusive."""
    q = (d.month - 1) // 3
    start_month = q * 3 + 1
    start = date(d.year, start_month, 1)
    if q == 3:
        end = date(d.year + 1, 1, 1)
    else:
        end = date(d.year, start_month + 3, 1)
    return start, end


def _prev_quarter_bounds(d: date) -> tuple[date, date]:
    q = (d.month - 1) // 3
    if q == 0:
        return date(d.year - 1, 10, 1), date(d.year, 1, 1)
    start_month = (q - 1) * 3 + 1
    start = date(d.year, start_month, 1)
    end = date(d.year, start_month + 3, 1)
    return start, end


def _quarter_label(start: date) -> str:
    q = (start.month - 1) // 3 + 1
    return f"Q{q} {start.year}"


def _fetch_summary(email: str, q_start: date, q_end: date) -> tuple[float, float]:
    """Return (actuals, target) for the given date range and email."""
    with get_session() as session:
        row = session.execute(
            text("""
                SELECT
                    COALESCE(SUM(Invoiceamount), 0) AS actuals,
                    COALESCE((
                        SELECT SUM(daily_target)
                        FROM (
                            SELECT MAX(targetsamount) AS daily_target
                            FROM VW_actuals_vs_targets_salescopilot
                            WHERE Email = :email
                              AND Accountingmonth >= :start
                              AND Accountingmonth < :end
                            GROUP BY Accountingmonth
                        ) t
                    ), 0) AS target
                FROM VW_actuals_vs_targets_salescopilot
                WHERE Email = :email
                  AND Accountingmonth >= :start
                  AND Accountingmonth < :end
            """),
            {"email": email, "start": q_start, "end": q_end},
        ).fetchone()
        return float(row.actuals or 0), float(row.target or 0)


def _fetch_top_closed(email: str, q_start: date, q_end: date, limit: int = 10) -> list[SalesTopDeal]:
    """Return top N days by total invoiced amount for the quarter."""
    with get_session() as session:
        rows = session.execute(
            text("""
                SELECT TOP (:limit)
                    Accountingmonth,
                    SUM(Invoiceamount) AS daily_total
                FROM VW_actuals_vs_targets_salescopilot
                WHERE Email = :email
                  AND Accountingmonth >= :start
                  AND Accountingmonth < :end
                GROUP BY Accountingmonth
                ORDER BY daily_total DESC
            """),
            {"email": email, "start": q_start, "end": q_end, "limit": limit},
        ).fetchall()
        return [
            SalesTopDeal(
                amount=float(r.daily_total or 0),
                invoice_date=str(r.Accountingmonth) if r.Accountingmonth else None,
            )
            for r in rows
        ]


def _resolve_email(user: User) -> str | None:
    """
    The view's Email column may differ from the login email.
    Try ms_email (from CXUserToken) first, then fall back to login email.
    Returns the first email that has data in the view, or None.
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


@router.get("/targets/summary", response_model=ResponseModel[SalesTargetSummary])
def get_targets_summary(current_user: User = Depends(get_current_active_user)):
    email = _resolve_email(current_user)
    if not email:
        from core.exceptions import BotApiException
        raise BotApiException(404, "ERR_NO_TARGET_DATA", "No target data found for this user.")

    today = date.today()
    q_start, q_end = _quarter_bounds(today)
    pq_start, pq_end = _prev_quarter_bounds(today)

    actuals, target = _fetch_summary(email, q_start, q_end)
    prev_actuals, prev_target = _fetch_summary(email, pq_start, pq_end)
    top_closed = _fetch_top_closed(email, q_start, q_end)

    pct_of_target = (actuals / target * 100) if target > 0 else 0.0
    prev_pct_of_target = (prev_actuals / prev_target * 100) if prev_target > 0 else 0.0
    pct_change = ((actuals - prev_actuals) / prev_actuals * 100) if prev_actuals > 0 else 0.0

    return ResponseModel(data=SalesTargetSummary(
        quarter_label=_quarter_label(q_start),
        actuals=actuals,
        target=target,
        pct_of_target=round(pct_of_target, 1),
        prev_quarter_label=_quarter_label(pq_start),
        prev_actuals=prev_actuals,
        prev_target=prev_target,
        prev_pct_of_target=round(prev_pct_of_target, 1),
        pct_change=round(pct_change, 1),
        top_closed=top_closed,
    ))
