"""
Microsoft Graph API utilities:
  1. OAuth2 delegated auth flow (connect / callback)
  2. Sending mail on behalf of the user
  3. Calendar events
  4. Token refresh
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional
from urllib.parse import urlencode

import httpx
import markdown as _markdown

import core.config as config
from core.exceptions import BotApiException

logger = logging.getLogger(__name__)

# ── OAuth2 constants ─────────────────────────────────────────────────────────

AUTHORITY = f"https://login.microsoftonline.com/{config.AZURE_INTEGRATION_TENANT_ID}"
TOKEN_URL = f"{AUTHORITY}/oauth2/v2.0/token"
AUTHORIZE_URL = f"{AUTHORITY}/oauth2/v2.0/authorize"

MAIL_SCOPES = [
    "openid", "email", "profile",
    "Mail.Send", "Mail.ReadWrite",
    "Calendars.ReadWrite",
    "People.Read",
    "offline_access",
]

GRAPH_ME_URL = "https://graph.microsoft.com/v1.0/me"
GRAPH_MESSAGES_URL = "https://graph.microsoft.com/v1.0/me/messages"
GRAPH_CALENDAR_VIEW_URL = "https://graph.microsoft.com/v1.0/me/calendarView"
GRAPH_EVENTS_URL = "https://graph.microsoft.com/v1.0/me/events"
GRAPH_PEOPLE_URL = "https://graph.microsoft.com/v1.0/me/people"


# ── Markdown -> HTML ─────────────────────────────────────────────────────────

def _md_to_html(body: str) -> str:
    """Convert markdown to HTML. Returns unchanged if already HTML."""
    stripped = body.lstrip()
    if stripped.startswith("<") and not stripped.startswith("<!"):
        return body
    return _markdown.markdown(body, extensions=["extra", "nl2br", "sane_lists"])


# ── Authorization URL ────────────────────────────────────────────────────────

def get_authorization_url(redirect_uri: str, state: str) -> str:
    """Build the Microsoft OAuth2 authorization URL."""
    params = {
        "client_id": config.AZURE_INTEGRATION_CLIENT_ID,
        "response_type": "code",
        "redirect_uri": redirect_uri,
        "response_mode": "query",
        "scope": " ".join(MAIL_SCOPES),
        "state": state,
        "prompt": "select_account",
    }
    return f"{AUTHORIZE_URL}?{urlencode(params)}"


# ── Token exchange ───────────────────────────────────────────────────────────

async def exchange_code_for_tokens(code: str, redirect_uri: str) -> dict:
    """Exchange an authorization code for access + refresh tokens."""
    payload = {
        "client_id": config.AZURE_INTEGRATION_CLIENT_ID,
        "client_secret": config.AZURE_INTEGRATION_CLIENT_SECRET,
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": redirect_uri,
        "scope": " ".join(MAIL_SCOPES),
    }
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(TOKEN_URL, data=payload)
        resp.raise_for_status()
        return resp.json()


async def refresh_access_token(refresh_token: str) -> dict:
    """Use a refresh token to obtain a new access token."""
    payload = {
        "client_id": config.AZURE_INTEGRATION_CLIENT_ID,
        "client_secret": config.AZURE_INTEGRATION_CLIENT_SECRET,
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "scope": " ".join(MAIL_SCOPES),
    }
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(TOKEN_URL, data=payload)
        resp.raise_for_status()
        return resp.json()


# ── User profile ─────────────────────────────────────────────────────────────

async def get_ms_user_profile(access_token: str) -> dict:
    """Fetch the connected Microsoft account's profile (email, name)."""
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            GRAPH_ME_URL,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        resp.raise_for_status()
        return resp.json()


# ── Send email ───────────────────────────────────────────────────────────────

async def send_mail_via_graph(
    access_token: str,
    to_address: str,
    subject: str,
    body_html: str,
    cc_addresses: Optional[list[str]] = None,
    bcc_addresses: Optional[list[str]] = None,
    attachments: Optional[list[dict]] = None,
    thread_id: Optional[str] = None,
    reply_to_message_id: Optional[str] = None,
) -> tuple[str | None, str | None, str | None]:
    """
    Send email via Microsoft Graph on behalf of the authenticated user.

    New email: draft -> send (two-step).
    Reply: find local message by conversationId -> createReply -> send.

    Returns (provider_message_id, provider_thread_id, internet_message_id).
    The internetMessageId is the RFC 5322 Message-ID header and is the key we
    use to thread with the email sync service and to fetch the conversation
    from Graph on a follow-up tick.
    """

    def _recipient(email: str) -> dict:
        return {"emailAddress": {"address": email}}

    auth_headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
        "Prefer": 'IdType="ImmutableId"',
    }

    attachment_list = (
        [
            {
                "@odata.type": "#microsoft.graph.fileAttachment",
                "name": a["name"],
                "contentType": a["content_type"],
                "contentBytes": a["content_bytes"],
            }
            for a in attachments
        ]
        if attachments
        else None
    )

    async with httpx.AsyncClient(timeout=30) as client:

        if reply_to_message_id:
            # ── REPLY PATH ──
            local_message_id: str | None = None

            if thread_id:
                search_url = f"{GRAPH_MESSAGES_URL}?$filter=conversationId eq '{_odata_encode(thread_id)}'&$top=1&$select=id"
                search_resp = await client.get(search_url, headers={"Authorization": f"Bearer {access_token}"})
                if search_resp.status_code == 200:
                    msgs = search_resp.json().get("value", [])
                    if msgs:
                        local_message_id = msgs[0].get("id")

            target_id = local_message_id or reply_to_message_id

            reply_message: dict = {
                "body": {"contentType": "HTML", "content": _md_to_html(body_html)},
                "toRecipients": [_recipient(to_address)],
            }
            if cc_addresses:
                reply_message["ccRecipients"] = [_recipient(e) for e in cc_addresses]
            if bcc_addresses:
                reply_message["bccRecipients"] = [_recipient(e) for e in bcc_addresses]
            if attachment_list:
                reply_message["attachments"] = attachment_list

            create_reply_resp = await client.post(
                f"{GRAPH_MESSAGES_URL}/{target_id}/createReply",
                json={"message": reply_message},
                headers=auth_headers,
            )
            create_reply_resp.raise_for_status()
            draft_data = create_reply_resp.json()
            draft_id: str | None = draft_data.get("id")
            conversation_id: str | None = draft_data.get("conversationId")

            send_resp = await client.post(
                f"{GRAPH_MESSAGES_URL}/{draft_id}/send",
                headers={"Authorization": f"Bearer {access_token}", "Content-Length": "0"},
            )
            send_resp.raise_for_status()
            message_id: str | None = draft_id

        else:
            # ── NEW EMAIL PATH ──
            message: dict = {
                "subject": subject,
                "body": {"contentType": "HTML", "content": _md_to_html(body_html)},
                "toRecipients": [_recipient(to_address)],
            }
            if cc_addresses:
                message["ccRecipients"] = [_recipient(e) for e in cc_addresses]
            if bcc_addresses:
                message["bccRecipients"] = [_recipient(e) for e in bcc_addresses]
            if attachment_list:
                message["attachments"] = attachment_list

            draft_resp = await client.post(GRAPH_MESSAGES_URL, json=message, headers=auth_headers)
            draft_resp.raise_for_status()
            draft_data = draft_resp.json()
            message_id = draft_data.get("id")
            conversation_id = draft_data.get("conversationId")

            send_resp = await client.post(
                f"{GRAPH_MESSAGES_URL}/{message_id}/send",
                headers={"Authorization": f"Bearer {access_token}", "Content-Length": "0"},
            )
            send_resp.raise_for_status()

        # Fetch the sent message to read its RFC InternetMessageId header.
        # The message lives in the user's Sent Items after send completes.
        internet_message_id: str | None = None
        if message_id:
            try:
                meta_resp = await client.get(
                    f"{GRAPH_MESSAGES_URL}/{message_id}",
                    params={"$select": "internetMessageId,conversationId"},
                    headers={"Authorization": f"Bearer {access_token}"},
                )
                if meta_resp.status_code == 200:
                    meta = meta_resp.json()
                    internet_message_id = meta.get("internetMessageId")
                    # Prefer the post-send conversationId if different from the draft's
                    conversation_id = meta.get("conversationId") or conversation_id
            except Exception:
                # Non-fatal — send already succeeded; we just won't have the internetMessageId
                pass

    return message_id, conversation_id, internet_message_id


def fetch_thread_by_message_id(
    access_token: str,
    internet_message_id: str,
    limit: int = 20,
) -> list[dict]:
    """Fetch the full email conversation for a given RFC internetMessageId.

    Two-step: look up the message → get its conversationId → fetch thread.
    Uses `requests` (not httpx) to avoid OData URL-encoding issues.

    Returns a list (oldest first) with keys matching fetch_thread_by_conversation_id.
    """
    import requests as req
    headers = {"Authorization": f"Bearer {access_token}"}

    # 1. Resolve conversationId
    resolve = req.get(GRAPH_MESSAGES_URL, params={
        "$filter": f"internetMessageId eq '{internet_message_id}'",
        "$top": "1",
        "$select": "id,conversationId",
    }, headers=headers, timeout=15)
    resolve.raise_for_status()
    msgs = resolve.json().get("value", [])
    if not msgs:
        return []
    conversation_id = msgs[0].get("conversationId")
    if not conversation_id:
        return []

    # 2. Delegate to conversation fetcher
    return fetch_thread_by_conversation_id(access_token, conversation_id, limit=limit)


def _odata_encode(value: str) -> str:
    """URL-encode a value for use inside an OData $filter expression.

    ConversationId values are base64 and contain = + / characters that break
    URL query-string parsing if left raw. Encoding the VALUE (not the operators)
    ensures the HTTP layer doesn't misparse them.
    """
    from urllib.parse import quote
    return quote(value, safe="")


def fetch_thread_by_conversation_id(
    access_token: str,
    conversation_id: str,
    limit: int = 30,
) -> list[dict]:
    """Fetch all emails in a conversation directly by conversationId.

    Uses `requests` (not httpx) because httpx re-encodes OData $filter URLs,
    breaking the base64 characters in conversationId values.

    Returns a list (oldest first) of message dicts.
    """
    import requests as req
    headers = {"Authorization": f"Bearer {access_token}"}

    me_resp = req.get(GRAPH_ME_URL, params={"$select": "mail,userPrincipalName"}, headers=headers, timeout=15)
    me_email = None
    if me_resp.status_code == 200:
        mm = me_resp.json()
        me_email = (mm.get("mail") or mm.get("userPrincipalName") or "").lower()

    select_fields = "id,conversationId,internetMessageId,subject,from,toRecipients,ccRecipients,bccRecipients,sentDateTime,receivedDateTime,body,hasAttachments"
    # Note: $orderby is NOT supported alongside $filter on conversationId
    # (Graph returns InefficientFilter). Sort in Python instead.
    resp = req.get(GRAPH_MESSAGES_URL, params={
        "$filter": f"conversationId eq '{conversation_id}'",
        "$top": str(limit),
        "$select": select_fields,
        "$expand": "attachments($select=id,name,contentType,size)",
    }, headers=headers, timeout=30)
    resp.raise_for_status()
    items = resp.json().get("value", [])
    # Sort by receivedDateTime ascending (oldest first)
    items.sort(key=lambda m: m.get("receivedDateTime") or m.get("sentDateTime") or "")

    out: list[dict] = []
    for m in items:
        from_obj = (m.get("from") or {}).get("emailAddress") or {}
        from_addr = from_obj.get("address") or ""
        to_list = [
            (r.get("emailAddress") or {}).get("address", "")
            for r in (m.get("toRecipients") or [])
        ]
        cc_list = [
            (r.get("emailAddress") or {}).get("address", "")
            for r in (m.get("ccRecipients") or [])
        ]
        # bccRecipients is only populated for items in the user's own Sent folder.
        # For received messages, BCC is (by design) invisible to the recipient.
        bcc_list = [
            (r.get("emailAddress") or {}).get("address", "")
            for r in (m.get("bccRecipients") or [])
        ]
        direction = "sent" if me_email and from_addr.lower() == me_email else "received"
        body = (m.get("body") or {}).get("content") or ""

        attachments = []
        for att in (m.get("attachments") or []):
            if att.get("@odata.type", "").endswith("itemAttachment"):
                continue
            attachments.append({
                "id": att.get("id") or "",
                "name": att.get("name") or "attachment",
                "content_type": att.get("contentType") or "application/octet-stream",
                "size": att.get("size") or 0,
            })

        out.append({
            "graph_message_id": m.get("id"),
            "direction": direction,
            "from_email": from_addr,
            "to_email": ", ".join([t for t in to_list if t]),
            "cc": ", ".join([c for c in cc_list if c]) or None,
            "bcc": ", ".join([b for b in bcc_list if b]) or None,
            "subject": m.get("subject") or "",
            "sent_time": m.get("sentDateTime"),
            "received_time": m.get("receivedDateTime"),
            "body": body[:8000],
            "internet_message_id": m.get("internetMessageId"),
            "conversation_id": m.get("conversationId"),
            "has_attachments": bool(m.get("hasAttachments")),
            "attachments": attachments,
        })
    return out


# ── Calendar events ──────────────────────────────────────────────────────────

async def fetch_calendar_events(
    access_token: str,
    start_dt: datetime,
    end_dt: datetime,
) -> list[dict]:
    """Fetch calendar events using calendarView (expands recurring events)."""
    fmt = "%Y-%m-%dT%H:%M:%S"
    params = {
        "startDateTime": start_dt.strftime(fmt),
        "endDateTime": end_dt.strftime(fmt),
        "$top": 100,
        "$orderby": "start/dateTime asc",
        "$select": (
            "id,subject,body,bodyPreview,start,end,isAllDay,isCancelled,"
            "showAs,responseStatus,organizer,attendees,location,"
            "isOnlineMeeting,onlineMeeting,recurrence,categories"
        ),
    }
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Prefer": 'outlook.timezone="UTC"',
    }
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(GRAPH_CALENDAR_VIEW_URL, params=params, headers=headers)
        resp.raise_for_status()
        return resp.json().get("value", [])


# ── Create / update / delete calendar events ─────────────────────────────────

def _build_attendees(required: list[str], optional: list[str]) -> list[dict]:
    result = []
    for email in required:
        email = email.strip()
        if email:
            result.append({"emailAddress": {"address": email}, "type": "required"})
    for email in optional:
        email = email.strip()
        if email:
            result.append({"emailAddress": {"address": email}, "type": "optional"})
    return result


async def create_calendar_event(
    access_token: str,
    subject: str,
    start_dt: datetime,
    end_dt: datetime,
    timezone_str: str = "UTC",
    location: Optional[str] = None,
    body: Optional[str] = None,
    is_online_meeting: bool = False,
    required_attendees: Optional[list[str]] = None,
    optional_attendees: Optional[list[str]] = None,
) -> dict:
    """Create a new calendar event. Returns the raw Graph event dict."""
    fmt = "%Y-%m-%dT%H:%M:%S"
    payload: dict = {
        "subject": subject,
        "start": {"dateTime": start_dt.strftime(fmt), "timeZone": timezone_str},
        "end":   {"dateTime": end_dt.strftime(fmt),   "timeZone": timezone_str},
        "isOnlineMeeting": is_online_meeting,
    }
    if location:
        payload["location"] = {"displayName": location}
    if body:
        payload["body"] = {"contentType": "Text", "content": body}
    attendees = _build_attendees(required_attendees or [], optional_attendees or [])
    if attendees:
        payload["attendees"] = attendees

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            GRAPH_EVENTS_URL,
            json=payload,
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
                # Force the response back in UTC so the frontend's `+Z` parse is correct.
                # Without this, Graph echoes back start/end in the timezone we submitted,
                # and the frontend would mis-interpret IST times as UTC.
                "Prefer": 'outlook.timezone="UTC"',
            },
        )
        resp.raise_for_status()
        return resp.json()


async def update_calendar_event(
    access_token: str,
    event_id: str,
    subject: Optional[str] = None,
    start_dt: Optional[datetime] = None,
    end_dt: Optional[datetime] = None,
    timezone_str: str = "UTC",
    location: Optional[str] = None,
    body: Optional[str] = None,
    is_online_meeting: Optional[bool] = None,
    required_attendees: Optional[list[str]] = None,
    optional_attendees: Optional[list[str]] = None,
) -> dict:
    """Patch an existing calendar event. Returns the updated raw Graph event dict."""
    fmt = "%Y-%m-%dT%H:%M:%S"
    payload: dict = {}
    if subject is not None:
        payload["subject"] = subject
    if start_dt is not None:
        payload["start"] = {"dateTime": start_dt.strftime(fmt), "timeZone": timezone_str}
    if end_dt is not None:
        payload["end"] = {"dateTime": end_dt.strftime(fmt), "timeZone": timezone_str}
    if location is not None:
        payload["location"] = {"displayName": location}
    if body is not None:
        payload["body"] = {"contentType": "Text", "content": body}
    if is_online_meeting is not None:
        payload["isOnlineMeeting"] = is_online_meeting
    if required_attendees is not None or optional_attendees is not None:
        payload["attendees"] = _build_attendees(
            required_attendees or [], optional_attendees or []
        )

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.patch(
            f"{GRAPH_EVENTS_URL}/{event_id}",
            json=payload,
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
                # Force response back in UTC (see create_calendar_event for rationale)
                "Prefer": 'outlook.timezone="UTC"',
            },
        )
        resp.raise_for_status()
        return resp.json()


async def delete_calendar_event(access_token: str, event_id: str) -> None:
    """Delete a calendar event."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.delete(
            f"{GRAPH_EVENTS_URL}/{event_id}",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        resp.raise_for_status()


async def search_people(access_token: str, query: str, top: int = 8) -> list[dict]:
    """Search for people in the tenant using the Graph People API.

    Returns an empty list (instead of raising) when the token lacks the
    People.Read scope (403) — the caller degrades gracefully to manual entry.
    """
    # Build the URL manually so OData $ params are not percent-encoded
    url = (
        f"{GRAPH_PEOPLE_URL}"
        f"?$search={query}&$top={top}"
        f"&$select=displayName,scoredEmailAddresses,jobTitle"
    )
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            url,
            headers={
                "Authorization": f"Bearer {access_token}",
                "X-PeopleQuery-QuerySources": "Mailbox,Directory",
            },
        )
        if resp.status_code == 403:
            logger.warning(
                "People search returned 403 — People.Read scope likely not yet consented. "
                "User should reconnect their Microsoft account."
            )
            return []
        resp.raise_for_status()
        raw = resp.json().get("value", [])
    results = []
    for p in raw:
        emails = p.get("scoredEmailAddresses") or []
        email = emails[0].get("address", "") if emails else ""
        if not email:
            continue
        results.append({
            "name": p.get("displayName") or "",
            "email": email,
            "jobTitle": p.get("jobTitle") or None,
        })
    return results


# ── Token helpers ────────────────────────────────────────────────────────────

def tokens_expire_at(expires_in_seconds: int) -> datetime:
    """Calculate token expiry from now (UTC)."""
    return datetime.now(timezone.utc) + timedelta(seconds=expires_in_seconds)


async def get_valid_ms_token(user_id: str) -> str:
    """
    Return a valid MS access token for user_id, refreshing if expired
    or expiring within 5 minutes. Reads from CX_UserTokens.

    Raises BotApiException (424) if no token or refresh fails.
    """
    from api.services.user_service import load_user_tokens, save_user_ms_tokens

    tokens = load_user_tokens(user_id)
    if not tokens or not tokens.access_token:
        raise BotApiException(
            code=424,
            message_code="ERR_MICROSOFT_NOT_CONNECTED",
            message="Microsoft account not connected. Please connect your account.",
        )

    now = datetime.now(timezone.utc)
    token_expiry = tokens.token_expiry
    if token_expiry is not None and token_expiry.tzinfo is None:
        token_expiry = token_expiry.replace(tzinfo=timezone.utc)
    needs_refresh = (
        token_expiry is None
        or token_expiry <= now + timedelta(minutes=5)
    )

    if not needs_refresh:
        return tokens.access_token

    if not tokens.refresh_token:
        raise BotApiException(
            code=424,
            message_code="ERR_MICROSOFT_NOT_CONNECTED",
            message="Microsoft token expired and no refresh token available. Please reconnect.",
        )

    logger.info("Refreshing expired MS token for user %s", user_id)
    try:
        token_data = await refresh_access_token(tokens.refresh_token)
    except httpx.HTTPStatusError as exc:
        logger.error("MS token refresh failed for user %s: %s", user_id, exc.response.text[:200])
        raise BotApiException(
            code=424,
            message_code="ERR_MICROSOFT_TOKEN_REFRESH",
            message="Failed to refresh Microsoft token. Please reconnect your account.",
        )

    new_access_token = token_data["access_token"]
    new_refresh_token = token_data.get("refresh_token", tokens.refresh_token)
    expires_in = int(token_data.get("expires_in", 3600))

    save_user_ms_tokens(
        user_id=user_id,
        ms_email=tokens.ms_email or "",
        access_token=new_access_token,
        refresh_token=new_refresh_token,
        expires_at=tokens_expire_at(expires_in),
    )

    return new_access_token
