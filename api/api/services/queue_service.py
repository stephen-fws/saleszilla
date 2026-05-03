"""Queue/folder operations."""

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select

from core.database import get_session
from core.models import Account, Contact, CXQueueItem, Potential
from core.schemas import FolderItem, QueueItemResponse

logger = logging.getLogger(__name__)


FOLDER_CONFIG = {
    "meeting-briefs": {"label": "Meeting Prep", "icon": "calendarCheck"},
    "new-inquiries": {"label": "New inquiries", "icon": "inbox"},
    "reply": {"label": "Reply", "icon": "reply"},
    "follow-up-active": {"label": "Follow up active", "icon": "refreshCw"},
    "follow-up-inactive": {"label": "Follow up inactive", "icon": "clock"},
    "news": {"label": "News", "icon": "newspaper"},
    "emails-sent": {"label": "Emails sent", "icon": "send"},
}


def list_folders(user_id: str | None = None) -> list[FolderItem]:
    """Get folder list with pending item counts."""
    with get_session() as session:
        # Lazy-cleanup so the New Inquiries badge count is honest even when
        # the dashboard polls before the user clicks into the folder.
        _expire_new_inquiries_off_open(session)

        stmt = select(
            CXQueueItem.folder_type,
            func.count(CXQueueItem.id).label("cnt"),
        ).where(
            CXQueueItem.status == "pending",
            CXQueueItem.is_active == True,
        )

        if user_id:
            # Scope by current Potential owner (not the stale
            # CXQueueItem.assigned_to_user_id) so counts shift to the new owner
            # immediately when CRM admin transfers ownership. Mirrors
            # list_queue_items.
            stmt = (
                stmt
                .join(Potential, CXQueueItem.potential_id == Potential.potential_number)
                .where(Potential.potential_owner_id == user_id)
            )

        stmt = stmt.group_by(CXQueueItem.folder_type)
        rows = {r[0]: r[1] for r in session.execute(stmt).all()}

    folders = []
    for folder_id, cfg in FOLDER_CONFIG.items():
        folders.append(FolderItem(
            id=folder_id,
            label=cfg["label"],
            icon=cfg["icon"],
            count=rows.get(folder_id, 0),
        ))
    return folders


def _potential_category(potential: Potential | None) -> str | None:
    if not potential:
        return None
    if potential.potential2close == 1:
        return "Diamond"
    if (potential.hot_potential or "").lower() == "true":
        return "Platinum"
    return None


def _expire_meeting_briefs(session) -> None:
    """Auto-complete meeting-brief queue items where the LATEST meeting for
    that potential has ended 1+ hours ago. Avoids killing current meetings
    when a potential has multiple meetings (old + upcoming)."""
    from core.models import CXMeeting, CXAgentInsight, CXAgentTypeConfig
    from sqlalchemy import func as sqlfunc
    now = datetime.utcnow()
    cutoff = now - timedelta(hours=1)

    # Find pending meeting-brief queue items
    pending_qis = session.execute(
        select(CXQueueItem).where(
            CXQueueItem.folder_type == "meeting-briefs",
            CXQueueItem.status == "pending",
            CXQueueItem.is_active == True,
        )
    ).scalars().all()
    if not pending_qis:
        return

    expired_qis = []
    for qi in pending_qis:
        # Get the LATEST meeting end_time for this potential
        latest_end = session.execute(
            select(sqlfunc.max(CXMeeting.end_time))
            .join(Potential, CXMeeting.potential_id == Potential.potential_id)
            .where(
                Potential.potential_number == qi.potential_id,
                CXMeeting.is_active == True,
                CXMeeting.end_time.isnot(None),
            )
        ).scalar()
        if latest_end and latest_end < cutoff:
            qi.status = "completed"
            qi.updated_time = now
            expired_qis.append(qi)

    # Mark meeting_brief next_action insights as actioned for expired potentials.
    # Meeting brief is additive (never skipped prior non-MB actions at fire time),
    # so expiry only affects its own insight row + its own queue item. Any FRE /
    # FU / reply that was pending alongside is unaffected and resumes visibility.
    if expired_qis:
        mb_agent_ids = set(session.execute(
            select(CXAgentTypeConfig.agent_id).where(
                CXAgentTypeConfig.trigger_category == "meeting_brief",
                CXAgentTypeConfig.is_active == True,
            )
        ).scalars().all())
        if mb_agent_ids:
            expired_pns = {qi.potential_id for qi in expired_qis}
            insights = session.execute(
                select(CXAgentInsight).where(
                    CXAgentInsight.potential_id.in_(expired_pns),
                    CXAgentInsight.agent_id.in_(mb_agent_ids),
                    CXAgentInsight.status != "actioned",
                    CXAgentInsight.is_active == True,
                )
            ).scalars().all()
            for ins in insights:
                ins.status = "actioned"
                ins.updated_time = now


def _expire_new_inquiries_off_open(session) -> None:
    """Auto-close New Inquiries queue items whose underlying potential is no
    longer in stage 'Open'. Catches the case where the stage was changed
    outside Salezilla (e.g. a sales rep edits it directly in the legacy CRM
    and the change syncs into our DB) — our `stage_update` agent's
    auto-close path doesn't fire then, so we clean up lazily on read.

    Side effects mirror `_close_fre_after_stage_change` in agent_service:
      • close the QI
      • retire pending newEnquiry next_action insights for that potential
      • log a timeline entry per potential (only when something was closed)
    """
    from core.models import CXAgentInsight, CXAgentTypeConfig, CXActivity
    now = datetime.utcnow()

    # Pending New Inquiries QIs joined to their Potential — pull stage so we
    # can identify the stale ones in one round-trip.
    rows = session.execute(
        select(CXQueueItem, Potential)
        .join(Potential, CXQueueItem.potential_id == Potential.potential_number)
        .where(
            CXQueueItem.folder_type == "new-inquiries",
            CXQueueItem.status == "pending",
            CXQueueItem.is_active == True,
            Potential.stage != "Open",
        )
    ).all()
    if not rows:
        return

    stale_pns = {qi.potential_id for qi, _ in rows}
    stale_potential_uuids = {p.potential_id for _, p in rows}

    # Close the QIs
    for qi, _ in rows:
        qi.status = "completed"
        qi.updated_time = now
        session.add(qi)

    # Retire pending newEnquiry next_action insights
    fre_rows = session.execute(
        select(CXAgentInsight)
        .join(CXAgentTypeConfig, CXAgentInsight.agent_id == CXAgentTypeConfig.agent_id)
        .where(
            CXAgentInsight.potential_id.in_(stale_pns),
            CXAgentInsight.is_active == True,
            CXAgentInsight.status.in_(("pending", "running", "completed")),
            CXAgentTypeConfig.tab_type == "next_action",
            CXAgentTypeConfig.trigger_category == "newEnquiry",
        )
    ).scalars().all()
    for r in fre_rows:
        r.status = "actioned"
        r.updated_time = now
        session.add(r)

    # Timeline entry per potential
    for _, p in rows:
        session.add(CXActivity(
            potential_id=p.potential_id,
            contact_id=p.contact_id,
            account_id=p.account_id,
            activity_type="fre_skipped_by_stage",
            description=f"First Response Email skipped — stage moved to \"{p.stage}\"",
            performed_by_user_id=None,
            created_time=now,
            updated_time=now,
            is_active=True,
        ))

    logger.info(
        "new-inquiries lazy-expire: closed %d QIs, retired %d FRE insights, %d potentials",
        len(rows), len(fre_rows), len(stale_potential_uuids),
    )


def list_queue_items(
    folder_type: str,
    user_id: str | None = None,
) -> list[QueueItemResponse]:
    """Get queue items for a specific folder."""
    with get_session() as session:
        # Auto-expire old meeting briefs before listing
        if folder_type == "meeting-briefs":
            _expire_meeting_briefs(session)
        # Lazy-cleanup New Inquiries whose Potential.Stage drifted off "Open"
        # (e.g. via legacy-CRM sync). Keeps the folder honest even when the
        # stage_update agent's auto-close path didn't fire.
        if folder_type == "new-inquiries":
            _expire_new_inquiries_off_open(session)

        # All folders: join with Potential/Account/Contact to render
        # identical cards to the Potentials list view.
        # CXQueueItem.potential_id stores 7-digit potential_number.
        # Use INNER JOIN on Potential when scoping to a user — we filter by
        # the Potential's CURRENT owner (not CXQueueItem.assigned_to_user_id,
        # which is set at creation and goes stale when CRM admin transfers
        # ownership). Without this, the original owner keeps seeing transferred
        # potentials in their folder and 403s on click.
        is_user_scoped = bool(user_id)
        join_fn = (lambda s, t, c: s.join(t, c)) if is_user_scoped else (lambda s, t, c: s.outerjoin(t, c))
        stmt = (
            select(CXQueueItem, Potential, Account, Contact)
        )
        stmt = join_fn(stmt, Potential, CXQueueItem.potential_id == Potential.potential_number)
        stmt = (
            stmt
            .outerjoin(Account, Potential.account_id == Account.account_id)
            .outerjoin(Contact, Potential.contact_id == Contact.contact_id)
            .where(
                CXQueueItem.folder_type == folder_type,
                CXQueueItem.status == "pending",
                CXQueueItem.is_active == True,
            )
            .order_by(CXQueueItem.created_time.desc())
        )
        if user_id:
            stmt = stmt.where(Potential.potential_owner_id == user_id)

        rows = session.execute(stmt).all()
        result = []
        for item, p, a, c in rows:
            deal_title = (p.potential_name if p else None) or item.title or "(untitled)"
            company = a.account_name if a else None
            contact_name = c.full_name if c else None
            parts = [x for x in [company, contact_name] if x]
            subtitle = " · ".join(parts) if parts else (item.subtitle or "")
            result.append(QueueItemResponse(
                id=item.id,
                potential_id=p.potential_id if p else item.potential_id,
                # CXQueueItem.potential_id is itself the 7-digit potential_number;
                # fall back to it when the Potential row hasn't been joined.
                potential_number=(p.potential_number if p else item.potential_id),
                contact_id=item.contact_id,
                account_id=item.account_id,
                folder_type=item.folder_type,
                title=deal_title,
                subtitle=subtitle,
                preview=item.preview,
                time_label=item.time_label,
                priority=item.priority,
                status=item.status,
                created_time=item.created_time,
                stage=p.stage if p else None,
                value=float(p.amount) if p and p.amount else None,
                service=p.service if p else None,
                category=_potential_category(p),
            ))
        return result


RESOLVED_STATUSES = {"completed", "skipped"}


def resolve_queue_item(item_id: int, status: str) -> bool:
    """Mark a queue item as resolved with the given terminal status.

    Allowed statuses:
      - 'completed' — user acted on the AI suggestion (FRE sent, todo done, etc.)
      - 'skipped'   — user dismissed the AI suggestion as not needed
    Both remove the item from the active queue but preserve the distinction
    so we can later analyze how often each AI item type is used vs ignored.
    """
    if status not in RESOLVED_STATUSES:
        return False
    now = datetime.now(timezone.utc)
    with get_session() as session:
        item = session.get(CXQueueItem, item_id)
        if not item:
            return False
        item.status = status
        item.updated_time = now
        session.add(item)
    return True


def complete_queue_item(item_id: int) -> bool:
    """Backwards-compatible alias — marks as 'completed'."""
    return resolve_queue_item(item_id, "completed")


def upsert_new_inquiry_queue_item(potential_id_or_number: str) -> bool:
    """Ensure a `new-inquiries` queue item exists for this potential.

    Idempotent — if a pending queue item for the same potential already
    exists (any folder), nothing happens. Otherwise creates one.

    Used by `/agents/init` (the external new-potential entry point) so that
    potentials inserted directly into the Potentials table by another team
    still surface in the New Inquiries folder. The Salezilla-internal
    `create_potential` flow already creates the queue item earlier and never
    routes through this helper.
    """
    from sqlalchemy import or_
    now = datetime.now(timezone.utc)
    with get_session() as session:
        # Resolve potential by UUID or 7-digit number, since the external
        # init route accepts either.
        p = session.execute(
            select(Potential).where(or_(
                Potential.potential_id == potential_id_or_number,
                Potential.potential_number == potential_id_or_number,
            ))
        ).scalar_one_or_none()
        if not p or not p.potential_number:
            return False
        pn = p.potential_number

        existing = session.execute(
            select(CXQueueItem).where(
                CXQueueItem.potential_id == pn,
                CXQueueItem.folder_type == "new-inquiries",
                CXQueueItem.is_active == True,
                CXQueueItem.status == "pending",
            )
        ).scalar_one_or_none()
        if existing:
            return False

        # Resolve company / contact names for the queue card subtitle.
        company_name = ""
        if p.account_id:
            acc = session.get(Account, p.account_id)
            company_name = acc.account_name if acc else ""
        contact_name = ""
        if p.contact_id:
            con = session.get(Contact, p.contact_id)
            contact_name = con.full_name if con else ""

        session.add(CXQueueItem(
            potential_id=pn,
            contact_id=p.contact_id,
            account_id=p.account_id,
            folder_type="new-inquiries",
            title=p.potential_name or "New Potential",
            subtitle=f"{company_name} · {contact_name}".strip(" ·") or None,
            preview=(p.description or "")[:300] if p.description else None,
            time_label=now.strftime("%H:%M"),
            priority=None,
            status="pending",
            assigned_to_user_id=p.potential_owner_id,
            created_time=now,
            updated_time=now,
            is_active=True,
        ))
        session.commit()
    return True


