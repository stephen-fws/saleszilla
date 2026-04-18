# Salezilla — Project Context for Claude

## What Is This

Salezilla is an AI-powered Sales CRM built for **Flatworld Solutions**. It surfaces a potentials-centric (deal-first) workflow with a 3-panel layout: folder sidebar → list panel → detail panel. A mock Next.js app (`mock_app_design/`) is the approved UI/UX reference — match its look and feel.

---

## Repository Layout

```
saleszilla/
├── api/                  # FastAPI backend (Python)
│   ├── main.py           # App entrypoint, all routers registered here
│   ├── core/
│   │   ├── config.py     # Env vars (MSSQL_*, JWT_*, AZURE_*, GCS_*, AGENTFLOW_*)
│   │   ├── database.py   # SQLAlchemy engine + session (SQL Server via pyodbc)
│   │   ├── models.py     # ORM models (Account, Contact, Potential, CXActivity, User, CXAgentInsight, CXAgentTypeConfig, …)
│   │   ├── schemas.py    # Pydantic request/response models
│   │   ├── auth.py       # JWT decode, get_current_active_user dependency
│   │   ├── ms_graph.py   # Microsoft Graph API helpers (calendar, people search, tokens)
│   │   └── exceptions.py # BotApiException
│   └── api/
│       ├── routes/       # One file per resource (auth, potentials, accounts, contacts, agents, …)
│       │   ├── chat.py            # Per-potential AI chat (history, stream, suggestions, clear)
│       │   ├── global_chat.py     # Global AI chat — multi-conversation, tool use
│       │   ├── meeting_briefs.py  # Meeting Briefs (GET /meetings/briefs/upcoming, POST resolve)
│       │   ├── sales.py           # Monthly sales target summary
│       │   ├── search.py          # Global search (user + team scope)
│       │   └── twilio.py          # Twilio calling (token, voice webhook, status, recording)
│       └── services/
│           ├── account_service.py
│           ├── potential_service.py    # Includes get_team_user_ids() for team hierarchy
│           ├── agent_service.py        # Agent triggers + meeting brief trigger + base research check
│           ├── chat_service.py         # Per-potential context assembly, Claude streaming
│           ├── global_chat_service.py  # Global chat: tool dispatch, streaming, conversations, title gen
│           ├── crm_query_tools.py      # 12 CRM query tools for global chat (search, aggregate, activity)
│           ├── chat_attachments.py     # PDF/DOCX/text extraction for chat file uploads
│           ├── meeting_brief_service.py # Meeting filter, CRM binding, skeleton builder
│           ├── twilio_service.py       # Twilio token gen, TwiML, call log upsert, recording download
│           └── access_control.py       # Ownership checks (user + team), entity-level access guards
└── ui/                   # React + Vite frontend (TypeScript)
    ├── index.html
    ├── vite.config.ts
    ├── src/
    │   ├── main.tsx
    │   ├── App.tsx            # BrowserRouter with routes
    │   ├── index.css          # Tailwind + custom scrollbar utilities
    │   ├── lib/
    │   │   ├── tokenStore.ts  # localStorage token persistence (keys: sz_access_token, sz_refresh_token)
    │   │   ├── httpClient.ts  # publicApi + protectedApi (Axios + JWT refresh interceptor)
    │   │   ├── api.ts         # All API calls, snake_case→camelCase mapping
    │   │   └── utils.ts       # cn(), formatCurrency(), formatDate()
    │   ├── store/
    │   │   └── authStore.ts   # Zustand auth (persisted as sz-auth-storage)
    │   ├── types/
    │   │   └── index.ts       # All shared TypeScript interfaces
    │   ├── pages/
    │   │   ├── LoginPage.tsx        # OTP login (email step → 6-digit code step)
    │   │   ├── DashboardPage.tsx    # Main 3-panel layout + top bar
    │   │   └── AuthCallbackPage.tsx # MS OAuth callback handler
    │   └── components/
    │       ├── auth/
    │       │   ├── ProtectedRoute.tsx
    │       │   └── OTPInput.tsx
    │       ├── sidebar/
    │       │   ├── FolderPanel.tsx        # Left panel: view toggle + folder list + team toggle + TargetWidget
    │       │   ├── TargetWidget.tsx       # Monthly revenue target progress bar (bottom of Panel 1)
    │       │   ├── MeetingBriefsList.tsx  # Panel 2 list for Meeting Briefs folder
    │       │   └── MeetingBriefOverlay.tsx # Panel 3 overlay for a single meeting brief (skeleton + AI)
    │       ├── queue/
    │       │   └── QueuePanel.tsx      # Queue item list (middle panel, queue view) + done/skip actions
    │       ├── potentials/
    │       │   ├── PotentialsList.tsx  # Deal cards (middle panel, potentials view) + team badge
    │       │   └── NewPotentialModal.tsx # Create new potential modal (default stage: Pre Qualified)
    │       ├── accounts/
    │       │   ├── AccountsList.tsx        # Account cards (middle panel, accounts view)
    │       │   └── AccountDetailPanel.tsx  # Right panel for accounts view
    │       ├── layout/
    │       │   └── GlobalSearch.tsx    # Top bar search (user + team scope, keyboard nav)
    │       ├── chat/
    │       │   ├── MarkdownBlock.tsx   # Shared markdown renderer (headings, tables, code, diagrams, hr)
    │       │   └── GlobalChatPanel.tsx # Full-screen global AI chat (multi-conversation, tool use, file upload)
    │       ├── detail/
    │       │   ├── DetailPanel.tsx     # Right panel router (potential detail, account detail, or meeting brief)
    │       │   ├── TabBar.tsx          # Tabs: base group + icon-only deal group + "Ask AI" pill
    │       │   ├── DetailsTab.tsx      # Includes chat-transcript normalisation for inbound leads
    │       │   ├── NotesTab.tsx
    │       │   ├── TodosTab.tsx        # Inline text editing + status change
    │       │   ├── FilesTab.tsx
    │       │   ├── TimelineTab.tsx
    │       │   ├── AgentResultTab.tsx  # Renders agent results (research/solution/next_action)
    │       │   ├── EmailsTab.tsx
    │       │   ├── ChatTab.tsx         # Per-potential AI chat with Claude streaming + web search
    │       │   ├── CallDialog.tsx      # Twilio browser calling modal (pre-call/in-call/post-call)
    │       │   └── NextActionTab.tsx   # FRE draft → email composer for new inquiries
    │       └── calendar/
    │           ├── CalendarPanel.tsx   # Full-screen calendar overlay (month/week/day views)
    │           └── EventFormModal.tsx  # Create/edit event modal (attendees persist on edit)
```

---

## Tech Stack

### Backend
- **Python 3.11+**, FastAPI, Uvicorn
- **SQLAlchemy** (sync) with **SQL Server** (pyodbc driver, `mssql+pyodbc`)
- **Pydantic v2** for request/response schemas
- **Database**: `CRMSalesPotentialls` on a SQL Server instance
- **Venv**: always use `api/venv_saleszilla/` — activate before running or pip-installing
- **Run**: `cd api && uvicorn main:app --reload --port 8000`

### Frontend
- **React 19 + Vite + TypeScript** (strict)
- **React Router v7** (SPA, `BrowserRouter`)
- **Tailwind CSS v4**
- **Zustand** (auth state, persisted to localStorage)
- **Axios** (HTTP, JWT interceptors)
- **Lucide React** (icons)
- **Run**: `cd ui && npm run dev` (port 3000 via `VITE_PORT=3000`)

### Environment variables
- `ui/.env` — `VITE_API_BASE_URL=http://localhost:8000`
- `api/.env` — `MSSQL_*`, `JWT_ACCESS_SECRET_KEY`, `JWT_REFRESH_SECRET_KEY`, `AZURE_*`, `GCS_BUCKET_NAME`, `GOOGLE_APPLICATION_CREDENTIALS`, `AGENTFLOW_BASE_URL`, `AGENTFLOW_API_KEY`, `AGENTFLOW_TRIGGER_CATEGORY`, `WEBHOOK_API_KEY`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_CALLING_NUMBER`, `TWILIO_API_KEY`, `TWILIO_API_SECRET`, `TWILIO_TWIML_APP_SID`, `BASE_URL`

---

## Database

SQL Server database: **CRMSalesPotentialls**

Key tables (ORM models in `api/core/models.py`):
| Table | Primary Key | Notes |
|---|---|---|
| `Accounts` | `account_id` (str) | Company data, billing address, industry |
| `Contacts` | `contact_id` (str) | Linked to Account, has title/email/phone/mobile/department |
| `Potentials` | `potential_id` (str) | Deals — linked to Account + Contact. Has `Potential Number` (7-digit str), `Potential2Close` (INT), `Hot_Potential` (str) |
| `CXActivities` | `id` (int) | Activity log — linked to Account + Potential, `is_active` BIT |
| `Users` | `user_id` (str) | App users, OTP login, MS OAuth tokens stored here |
| `CX_AgentInsights` | `id` (int) | Agent results per potential — status: pending/running/completed/error. Has `MSEventId` for meeting briefs (NULL for regular agents). UNIQUE on `(PotentialId, AgentType, MSEventId)` |
| `CX_AgentTypeConfig` | `agent_id` (str) | Registry of agents — maps agent_id to tab_type, content_type, sort_order |
| `CX_CallLogs` | `id` (int) | Call records — has `TwilioCallSid` for linking to Twilio calls, `RecordingUrl`/`RecordingFileId` for GCS recordings, `Transcript` for call transcription |
| `CX_ChatMessages` | `id` (int) | Per-potential AI chat history — keyed on `potential_id` = **potential_number** (7-digit), not UUID |
| `CX_GlobalChatConversations` | `id` (int) | Global chat threads per user — has `Title` (AI-generated after first response) |
| `CX_GlobalChatMessages` | `id` (int) | Global chat messages — has `ConversationId` FK to conversations table |
| `CX_UserTokens` | — | MS OAuth tokens per user — has `ms_email`, `WorkingHoursStart/End`, `Timezone`, `EmailSignature` |
| `VW_actuals_vs_targets_salescopilot` | — | SQL Server view — daily invoice rows. Has `CustomerName`, `Email`, `Accountingmonth`, `Invoiceamount`, `targetsamount` columns |

**Critical SQLAlchemy gotcha**: SQL Server BIT columns — use `== True` not `.is_(True)` in WHERE clauses.

---

## Authentication

- **OTP login**: `POST /auth/otp/send` (email) → `POST /auth/otp/verify` (email + 6-digit code) → returns `access_token` + `refresh_token`
- **JWT**: access token stored in `localStorage` as `sz_access_token`; refresh token as `sz_refresh_token`
- **Auto-refresh**: `protectedApi` intercepts 401 → calls `GET /auth/refresh` with refresh token → retries original request transparently. Multiple concurrent 401s are queued and replayed after one refresh.
- **Force logout**: clears tokens + redirects to `/login` if refresh fails

---

## API Overview

All responses are wrapped in `ResponseModel<T>`:
```json
{ "status": "OK", "message_code": null, "message": null, "data": <T> }
```

### Registered Routers (`api/main.py`)
| Prefix | File | Purpose |
|---|---|---|
| `/auth` | `routes/auth.py` | OTP login, refresh, /me, MS OAuth |
| `/potentials` | `routes/potentials.py` | List, detail, CRUD |
| `/accounts` | `routes/accounts.py` | List, detail, PATCH |
| `/contacts` | `routes/contacts.py` | PATCH contact fields |
| `/folders` | `routes/queue.py` | Folder list with counts |
| `/queue/{folder_type}` | `routes/queue.py` | Queue items per folder |
| `/queue-items/{id}/complete` | `routes/queue.py` | Mark item done |
| `/queue-items/{id}/skip` | `routes/queue.py` | Mark item skipped (not needed) |
| `/potentials/{id}/notes` | `routes/notes.py` | Notes CRUD |
| `/potentials/{id}/todos` | `routes/todos.py` | Todos CRUD |
| `/potentials/{id}/files` | `routes/files.py` | File upload/download (GCS) |
| `/calls` | `routes/calls.py` | Call logs |
| `/activities` | `routes/activities.py` | Activity log |
| `/agents` | `routes/agents.py` | Agent insight requests + webhook + run/init |
| `/emails` | `routes/emails.py` | Draft + send via MS Graph |
| `/calendar/events` | `routes/calendar.py` | MS Graph calendar CRUD |
| `/calendar/people` | `routes/calendar.py` | MS Graph people search |
| `/potentials/{id}/chat/history` | `routes/chat.py` | GET chat history |
| `/potentials/{id}/chat` | `routes/chat.py` | POST — stream Claude response (SSE) |
| `/potentials/{id}/chat/suggestions` | `routes/chat.py` | GET AI-generated suggested questions |
| `/potentials/{id}/chat/history` | `routes/chat.py` | DELETE — soft-delete all messages |
| `/sales/targets/summary` | `routes/sales.py` | Monthly revenue target vs actuals for current user |
| `/search` | `routes/search.py` | Global search across potentials, accounts, contacts (user + team scope) |
| `/chat/global/conversations` | `routes/global_chat.py` | CRUD for global chat conversations |
| `/chat/global/conversations/{id}` | `routes/global_chat.py` | POST stream message in conversation |
| `/chat/global/conversations/{id}/upload` | `routes/global_chat.py` | POST stream with file attachments (multipart) |
| `/chat/global/conversations/{id}/messages` | `routes/global_chat.py` | GET conversation messages |
| `/meetings/briefs/upcoming` | `routes/meeting_briefs.py` | GET upcoming client meeting briefs (lazy-load + skeleton) |
| `/meetings/briefs/{ms_event_id}/resolve` | `routes/meeting_briefs.py` | POST mark brief done/skipped |
| `/twilio/token` | `routes/twilio.py` | POST — generate Twilio Access Token for browser Voice SDK |
| `/twilio/contacts/{potential_id}` | `routes/twilio.py` | GET — contacts with phone numbers for calling |
| `/twilio/call-log` | `routes/twilio.py` | POST — create/update call log (upserts by twilio_call_sid) |
| `/twilio/voice` | `routes/twilio.py` | POST — Twilio webhook: returns TwiML for outbound call |
| `/twilio/status` | `routes/twilio.py` | POST — Twilio webhook: call status updates |
| `/twilio/recording-status` | `routes/twilio.py` | POST — Twilio webhook: recording ready → download + GCS upload |

---

## Frontend Architecture

### Routing (`App.tsx`)
```
/login          → LoginPage (public)
/auth/callback  → AuthCallbackPage (MS OAuth)
/               → DashboardPage (protected)
*               → redirect to /
```

### DashboardPage layout
Three-panel responsive layout:
1. **Left** — `FolderPanel`: view mode toggle (Queue / Potentials / Accounts) + folder list (Queue mode) or filter sidebar (Potentials/Accounts mode)
2. **Middle** — `QueuePanel` | `PotentialsList` | `AccountsList` depending on view mode
3. **Right** — `DetailPanel` (potential detail with tabs) or `AccountDetailPanel` (account detail with tabs)

**Top bar** includes:
- Next upcoming meeting pill (left-aligned; refreshes every 5 min, ticks every 1 min, shows meetings within 8 hours; uses MS Graph)
- `GlobalSearch` (centered, `flex-1 justify-center`) — open text search across potentials, accounts, contacts scoped to user + team; grouped dropdown results; keyboard navigation (↑↓ Enter Esc)
- **"Ask AI"** button (blue gradient pill, Google Cloud Console theme) → opens `GlobalChatPanel` full-screen overlay
- Calendar button + user avatar dropdown (right-aligned, `ml-auto`)

### State management
- `useAuthStore` (Zustand, persisted) — user object + isAuthenticated
- All other state is local `useState` in `DashboardPage` (selected deal/account IDs, view mode, filters, etc.)
- `newDealInitialTab` — set to `"action"` after new potential created; resets tab in DetailPanel to Next Action automatically

### HTTP client (`lib/httpClient.ts`)
- `publicApi` — no auth (login endpoints)
- `protectedApi` — auto Bearer token + 401→refresh interceptor

### API layer (`lib/api.ts`)
- All backend `snake_case` fields mapped to frontend `camelCase`
- **MS Graph datetime fix**: backend now explicitly converts all Graph datetimes to UTC with `Z` suffix server-side (via `_graph_dt_to_utc_iso` in `routes/calendar.py` which resolves Windows tz names → IANA → UTC). Frontend `toUTCString()` still appends `Z` as a safety net.
- All functions throw on non-2xx (Axios default); callers catch as needed

---

## Calendar Feature

- MS Graph backed via `core/ms_graph.py`
- **Required scopes**: `Calendars.ReadWrite`, `Mail.Send`, `People.Read`, `offline_access`
- `People.Read` needed for attendee autocomplete search (`GET /me/people?$search=...`)
- **OData `$` params**: for `$search`, build raw URL string. For `$filter` with conversationId/internetMessageId (base64 values with `=`), use `requests` library `params` dict (not httpx — httpx re-encodes breaking the filter). `$orderby` is NOT supported alongside `$filter` on conversationId (Graph returns InefficientFilter).
- **Timezone**: event creation uses browser's IANA timezone (`Intl.DateTimeFormat().resolvedOptions().timeZone`) passed as `timezone` field to backend/Graph
- **Cross-midnight events**: `EventFormModal` tracks `endDate` separately from `date`; auto-advances to next day when end time ≤ start time using `timeToMinutes()` for numeric comparison (avoids string comparison bugs like `"23:15" >= "00:15"` being true)
- **New event default time**: rounds current time up to next 30-minute boundary
- **After create/delete**: 2-second delay before refreshing next meeting (MS Graph propagation lag)
- **Attendee search**: debounced 300ms, min 2 chars, keyboard navigation (↑↓ Enter Esc), gracefully handles 403 (People.Read not consented)
- **Attendees persist on edit**: `openEditEvent` now passes `requiredAttendees` / `optionalAttendees` from `UIEvent` to `EventFormDefaults`. Previously attendees were dropped on edit.
- **Attendee response status**: each attendee has a `response` field (`accepted`, `declined`, `tentativelyAccepted`, `notResponded`). Event detail popover shows a summary line ("5 invited · 3 accepted · 1 declined") and color-coded chips (green=accepted, red=declined+strikethrough, amber=tentative, gray=pending).
- **Past events grayed out**: events where `endAt < now` render with `bg-slate-100 / text-slate-400` instead of their normal color. Applies to all calendar views (month/week/day).
- **Outlook-style single blue color**: all events use blue — no per-event color rotation. `colorForId()` always returns `"blue"`.
- **Description with clickable links**: `EventFormModal` textarea for description is resizable (`resize-y`, `min-h-[100px]`, `max-h-[300px]`). URLs in the description are detected live and rendered as clickable chips below the textarea (Teams → "Teams Meeting", Zoom → "Zoom Meeting", Google Meet → "Google Meet", others truncated).
- **Timezone conversion for create/update responses**: `_graph_dt_to_utc_iso()` in `routes/calendar.py` handles Windows tz names (`"India Standard Time"`) and IANA names, converts to UTC explicitly. Includes a fallback fixed-offset table for Windows environments without `tzdata` installed. Install `tzdata` pip package for full DST support.

---

## Access Control & Team Hierarchy

### Ownership policy
- **UI navigation** (search, detail GETs/PATCHes) is restricted to records the user OWNS, their **direct reports** own, or **accounts where user/team owns a potential**.
- **Global chat agent** has all-org access for aggregate analytics.

### Access rules
A user can access:
- **Potential**: user/team is the `potential_owner_id`
- **Account**: user/team is the `account_owner_id` OR user/team owns any potential on it
- **Contact**: user/team is the `contact_owner_id` OR user/team can access the contact's account (above rule)

### Team hierarchy
- `User.reporting_to` stores the **manager's email** (not user_id)
- `get_team_user_ids(manager_user_id)` in `potential_service.py`: resolves the manager's email → finds `User` rows where `reporting_to == email` → returns their `user_id` list
- `_get_allowed_owner_ids(user_id)` in `access_control.py`: `{user_id} + team_ids`

### Enforcement points
| Layer | Scope |
|---|---|
| `GET /search` | Potentials/accounts/contacts accessible to user + team (includes potential-on-account rule) |
| `GET /potentials` | `?include_team=true` includes direct reports' deals |
| `GET /potentials/{id}` | `require_potential_owner` (user + team) |
| `PATCH /potentials/{id}` | Same |
| `GET /accounts/{id}` | `require_account_owner` (user + team + owns-potential-on-account) |
| `PATCH /accounts/{id}` | Same |
| `PATCH /contacts/{id}` | `require_contact_owner` (user + team + account-access fallback) |
| `GET /contacts` | Contacts owned by user/team OR on accounts where user/team owns a potential |
| `GET/POST/PATCH/DELETE /potentials/{id}/notes` | `require_potential_owner` |
| `GET/POST/PATCH/DELETE /potentials/{id}/todos` | `require_potential_owner` |
| `GET/POST/DELETE /potentials/{id}/files` | `require_potential_owner` |
| `GET/POST /potentials/{id}/calls` | `require_potential_owner` |
| `GET /potentials/{id}/activities` | `require_potential_owner` |
| `POST/GET /potentials/{id}/agents/*` | `require_potential_owner` (user-triggered only; webhook uses API key) |
| `GET/POST/DELETE /potentials/{id}/chat/*` | `require_potential_owner` |
| `GET/POST/PATCH/DELETE /potentials/{id}/drafts/*` | `require_potential_owner` |
| `POST /potentials/{id}/send-email` | `require_potential_owner` |

### "Include My Team" toggle (Panel 1, Potentials view)
- Toggle in the Potentials filter sidebar (between search and sort)
- OFF (default): owner filter shows only "You" (locked checkbox), potentials scoped to current user
- ON: owner filter expands to show team members (from `filterOptions.owners` scoped to user + reports); all checkboxes are interactive so manager can select specific reportees; current user's checkbox also unlockable when team is ON
- Panel 2 deal cards show an **indigo team badge** (`👥 Owner Name`) when the deal belongs to a reportee

---

## Global AI Chat (`GlobalChatPanel.tsx`)

### Overview
Full-screen overlay accessible from the top bar "Ask AI" button. Multi-conversation, tool-based, streams Claude responses with CRM query tools.

### Architecture
- **Multi-conversation**: sidebar lists all threads sorted by recency. "New chat" button. Click to switch. Delete on hover.
- **Tool use**: Claude calls 12 CRM query tools to answer questions about potentials, accounts, contacts, pipeline, revenue, activity. Multi-turn: model → tool_use → execute → tool_result → model continues.
- **Auto title**: after the first assistant response in an untitled conversation, a one-shot Claude call generates a 3-6 word title. Emits a `{type: "title"}` SSE event so the sidebar updates live.

### CRM query tools (`crm_query_tools.py`)
| Tool | Purpose |
|---|---|
| `search_potentials` | Filter by stage/service/owner/country/amount/date/flags |
| `get_potential_details` | Single potential quick lookup |
| `get_potential_full_context` | Deep context (notes, todos, emails, AI insights) — reuses `build_context_prompt` from per-potential chat |
| `search_accounts` | Filter by industry/country/name/revenue |
| `get_account_360` | Full account + contacts + potentials |
| `search_contacts` | Filter by name/email/department/account |
| `get_contact_details` | Single contact + linked potentials |
| `pipeline_summary` | Aggregation by stage/service/owner/country/lead_source/type/deal_size |
| `revenue_summary` | Revenue totals for a period (open pipeline + closed-won + lost) |
| `time_based_query` | Closing soon, overdue, created/modified in N hours/days, stale in stage |
| `recent_activity` | Queries `CX_Activities` audit log — notes/todos/emails/calls/stage changes |
| `list_owners` | Resolve user names/emails |

### System prompt highlights
- Pagination awareness: always check `total` vs `returned`; use aggregation tools for "how many" questions
- Conversation continuity: reuse filters from previous turns
- Ambiguous questions: show overview breakdown first, ask which to drill into
- Follow-ups: every response ends with `<followups>["Q1","Q2","Q3"]</followups>` rendered as clickable chips
- Honest about gaps: when data isn't tracked, say so

### UI features
- **Google Cloud Console blue** color theme (not violet/Anthropic)
- Conversation search in sidebar (client-side title filter)
- Starter question cards on empty state (6 pre-built)
- Tool indicator pills ("Searching potentials…", "Calculating pipeline…", etc.)
- Typing indicator (bouncing dots) before first text/tool
- Stop button (red square)
- Copy + PDF export per response (renders via `renderToStaticMarkup` + browser print)
- Follow-up question chips (auto-generated, contextual, clickable)
- **File upload**: paperclip button, multi-file, PDF/DOCX text extraction (via `pypdf` + `python-docx`), TXT/CSV/code files. Extracted text is embedded in the user message so follow-up turns retain context.
- User messages: slate-100 gray background (not blue)
- Web search: enabled via Anthropic's `web_search_20250305` tool (per-potential chat only)

### SSE event types
```
{type: "tool", name: "search_potentials", status: "running"}
{type: "text", content: "..."}
{type: "done", message_id: 123}
{type: "title", title: "Pipeline By Stage Overview"}
{type: "error", message: "..."}
```

---

## Meeting Briefs

### Overview
Panel 1 has a "Meeting Briefs" folder. Clicking it shows qualifying client meetings in Panel 2. Clicking a brief opens a focused overlay in Panel 3 with an instant skeleton (DB data) + AI-generated brief (agent output).

### Filter rules (deterministic, no AI classification)
A meeting qualifies only if at least one is true:
1. Already linked to a Potential (`CX_Meetings.PotentialId`)
2. External attendee email matches a Contact in CRM
3. External attendee email domain matches an Account.website domain

Internal-only meetings (all attendees `@flatworldsolutions.com`), cancelled events, and user-dismissed briefs are silently dropped.

### Trigger model (lazy-load, no scheduler)
| Trigger | When |
|---|---|
| Dashboard mount | Once per page load |
| `visibilitychange → visible` | User switches back to the Salezilla browser tab |
| Calendar overlay close | After user closes the in-app calendar (2-sec delay) |
| Polling (30 sec) | Only while any brief is `pending`/`running` |

### Idempotency
- `CX_AgentInsights` row per `(potential_id, ms_event_id)` with UNIQUE constraint
- 5-min hard floor: won't re-trigger the same meeting's brief within 5 min
- TTL: brief regenerates after 4 hours OR when the linked Potential has been modified since generation
- `CX_MeetingBriefDismissals`: user can mark a brief as `done` (attended) or `skipped` (not needed); dismissed events are filtered out on next refresh

### Agent trigger payload
Two cases based on `has_all_base_research_completed(potential_id)`:
- **Base research missing** → `category: "meeting-prep"` (agentflow chains research → meeting_brief)
- **Base research cached** → `category: "meeting-brief-only"` (agentflow runs just the brief)

Both include `meeting_info` nested object:
```json
{
  "ms_event_id": "...",
  "title": "Acme Discovery Call",
  "start": "2026-04-09T14:00:00",
  "end": "2026-04-09T15:00:00",
  "is_online": true,
  "location": "Microsoft Teams Meeting",
  "organizer": "alice@flatworldsolutions.com",
  "attendees": [{"email": "john@acme.com", "name": "John Doe", "domain": "acme.com"}],
  "agenda": "Discuss requirements..."
}
```

### Rendering
- **Skeleton (instant, 0ms)**: meeting time, linked deal (name/stage/amount/probability/closing date/owner), account, contact, external attendees, rollups (notes count, open todos, recent emails)
- **AI Brief (agent, ~30s)**: talking points, suggested questions, risks, recent activity summary — rendered via shared `MarkdownBlock`
- **Done/Skip actions**: hover cards in Panel 2 → ✓ Done (emerald) / ✕ Skip (red) icons

### Queue item actions (all folders)
All queue items (not just meeting briefs) now have Done/Skip hover actions:
- `POST /queue-items/{id}/complete` → `status = "completed"`
- `POST /queue-items/{id}/skip` → `status = "skipped"`
- Optimistic UI removal + folder count decrement

---

## Monthly Revenue Target (`TargetWidget.tsx`)

- Shown at the bottom of Panel 1 (`FolderPanel`), outside the scrollable area
- `GET /sales/targets/summary` — resolves user's MS email via `CX_UserTokens.ms_email` (fallback: login email), queries `VW_actuals_vs_targets_salescopilot` for **current month** (not quarter)
- **Target calculation**: direct `SUM(targetsamount)` for the month (no deduplication needed — one target amount per `(CustomerName, day)` row)
- **Actuals**: `SUM(Invoiceamount)` for the month
- Progress bar color: red (<40%) → amber (40–75%) → blue (75–99%) → green (≥100%)
- Trending arrow + % change vs **previous month**
- Click → modal with **top 10 accounts by invoiced amount** (grouped by `CustomerName` column)
- Period label: e.g. "April 2026" (was previously quarterly)

---

## Potential Detail Panel (`DetailsTab.tsx`)

3-section panel (Deal / Contact / Company) in the right column when a potential is selected.

### Header badges
- **`#XXXXXXX`** monospace badge — `potential_number` (7-digit, read-only, main identifier)
- **💎 Diamond** — shown when `Potential2Close = 1`
- **🏆 Platinum** — shown when `Hot_Potential = 'true'` and not Diamond
- **Stage badge** (right-aligned, clickable dropdown)

### Category logic (`_potential_category` in `potential_service.py`)
```python
if potential2close == 1 → "Diamond"
elif hot_potential == "true" → "Platinum"
else → "Other"  # no badge shown
```

### Editable fields (inline, hover to reveal pencil)
- **Title** — text input
- **Stage** — color badge → dropdown with real DB stage names
- **Value** (`amount`) — number input
- **Probability** — number input, validated 0–100
- **Closing Date** — date picker
- **Service** — dropdown populated from DB filter options
- **Sub-service** — free text input
- **Type** (`deal_type`) — free text input
- **Deal Size** — free text input
- **Lead Source** — free text input
- **Next Step** — text input
- **Description** — textarea, Shift+Enter to save, URLs auto-linked via `LinkifiedText`. Chat-form transcript descriptions (inbound website leads) are auto-normalized: `normalizeChatTranscript()` injects newlines before timestamp patterns and section headers so each chat message renders on its own line. Editing loads the normalized version; saving persists the newlines back to DB so they don't need re-normalization.

### Read-only fields
Owner, Created date, Potential Number

→ `PATCH /potentials/{id}` → `update_potential()` service → returns full `PotentialDetailResponse`

### `UpdatePotentialRequest` schema fields
`title`, `stage`, `amount`, `probability`, `closing_date` (ISO `YYYY-MM-DD`), `next_step`, `description`, `service`, `sub_service`, `lead_source`, `deal_type`, `deal_size`

### Stage color map
`STAGE_COLORS` covers real Zoho-style DB names (Prospects, Pre Qualified, Requirements Capture, Proposal, Contracting, Closed, Contact Later, Sleeping, Low Value, Disqualified, Lost) plus normalized mock names as fallback.

---

## Potential List Cards (Panel 2)

- **Icon**: Briefcase (represents a deal, not a company)
- **Headline**: potential name (`deal.title`)
- **Line 2**: company name
- **Line 3**: contact name · title
- **Team badge** (indigo, `👥 Owner Name`): shown when "Include My Team" is ON and the deal belongs to a reportee (not the logged-in user)
- **Top-right**: deal value
- **Bottom row**: stage badge, 💎/🏆 category badge (if applicable), service label

---

## Account Detail Panel (`AccountDetailPanel.tsx`)

4-tab panel shown in right column when an account is selected:
- **Overview** — stats grid (potentials, pipeline value, contacts), closed-won banner, editable company fields
- **Contacts** — contact cards with editable fields, quick email/phone links, associated potentials per contact
- **Potentials** — clickable cards; clicking navigates to potential detail via `onPotentialNavigate`
- **Activity** — timeline of `CXActivities` with type-based icons

### Inline editing
`EditableField` component: hover → pencil icon → click → inline input. Enter/blur commits, Escape cancels.

**Account fields** (editable): industry, website, employees, revenue, billing city/state/country, description
→ `PATCH /accounts/{id}` → `update_account()` service → returns full `AccountDetailResponse`

**Contact fields** (editable): title, email, phone, mobile, department
→ `PATCH /contacts/{contact_id}` → `patch_contact()` route → returns `AccountDetailContact`

---

## Potentials Filter Sidebar (Panel 1)

Stage, Service, and Owner filters are **dynamically populated from the DB** via `filter_options` returned by `GET /potentials`. Never hardcoded. Filter options are **scoped to the same owner set** as the main query (user only, or user + team when `include_team=true`).

- `getPotentials({ includeTeam })` returns `filterOptions: { owners, services, stages }` scoped to the allowed owner IDs
- **"Include My Team" toggle**: when ON, owner filter shows the user + direct reports; when OFF, shows only the user (locked checkbox)
- Stage names displayed as-is from DB (no normalisation)

---

## Queue Folders

Active folders (defined in `queue_service.py`). All folders use `CXQueueItem` rows and render as potential cards via `QueuePanel`:
1. **Meeting Briefs** — client meetings with AI-prepared meeting prep. Auto-expires 1hr after meeting end.
2. **New Inquiries** — newly created potentials awaiting FRE
3. **Reply** — client replied, reply draft ready
4. **Follow Up Active** — follow-up draft ready (stage NOT IN Sleeping/Contact Later)
5. **Follow Up Inactive** — follow-up for sleeping/contact-later potentials
6. **News** — CRM news items
7. **Emails Sent** — potentials where user sent email (no Done/Skip actions — action already taken). Deduplicated per potential.

All folders except Emails Sent have Done/Skip hover actions. Outlook-style date grouping on all lists.
`CXQueueItem.potential_id` stores the **7-digit potential_number**. API response resolves UUID via Potential join for frontend navigation.

---

## Agent System Integration

### Overview
External agentflow system processes potentials and pushes results back. Salezilla triggers it and receives results via webhook.

### Tables
- **`CX_AgentTypeConfig`** — registry of agents. Each row: `agent_id`, `agent_name`, `tab_type` (research/solution_brief/next_action), `trigger_category` (newEnquiry/followUp/reply/meeting_brief), `content_type` (markdown/html), `sort_order`, `is_active`. `TriggerCategory` drives which agents are created for each workflow.
- **`CX_AgentInsights`** — results per potential per agent. Status: `pending` → `completed` / `error` / `actioned`. Keyed on 7-digit potential_number (not UUID).
- **`CX_AgentDraftHistory`** — append-only audit log. Snapshots draft content before overwrite/resolve with `Resolution` (done/skip/replaced/overwritten).

### Trigger flow
`init_agents_for_potential(potential_id, triggered_by)`:
1. Always POSTs to agentflow gateway (independent of config rows)
2. If `CX_AgentTypeConfig` has active rows → creates `pending` insight rows per agent

### Agentflow POST payload
```json
{
  "event_source": "crm",
  "action": "create",
  "entity_type": "sales_lead",
  "entity_id": "<potential_number>",
  "data": {
    "potential_id": "<potential_number>",
    "company_name": "...",
    "company_website": "...",
    "contact_email": "...",
    "contact_phone": "...",
    "customer_name": "...",
    "service": "...",
    "sub_service": "...",
    "lead_source": "...",
    "customer_requirements": "...",
    "category": "meeting-prep | meeting-brief-only",
    "meeting_info": { "ms_event_id": "...", "title": "...", "start": "...", "end": "...", "is_online": true, "location": "...", "organizer": "...", "attendees": [...], "agenda": "..." }
  }
}
```
Headers: `x-api-key: AGENTFLOW_API_KEY`
URL: `AGENTFLOW_BASE_URL/webhooks/crm`

`category` and `meeting_info` are only present for meeting brief triggers:
- `meeting-prep` — base research missing, agentflow chains all agents → meeting_brief
- `meeting-brief-only` — base research cached, agentflow runs just meeting_brief

### Webhook receive (agentflow → Salezilla)
`POST /agents/webhook` — content delivered inline in payload (no secondary fetch):
```json
{ "agent_id": "...", "external_id": "<potential_id>", "status": "completed", "content": "...", "content_type": "markdown", "ms_event_id": "..." }
```
Matched to `CX_AgentTypeConfig` by `agent_id`. Unknown agent_ids are ignored. `ms_event_id` is only set for `meeting_brief` results (routes the result to the correct per-meeting row in `CX_AgentInsights`).

### When agents are triggered
1. **Manual creation** (`NewPotentialModal`) — triggered automatically after commit
2. **External service creation** — other team calls `POST /potentials/{id}/agents/init` with `x-api-key` header after inserting into DB
3. **User re-run** — `POST /potentials/{id}/agents/run` (authenticated, from Research/Solution tabs)

### UI behaviour
- After creating a new potential: auto-navigates to deal, auto-opens **Next Action** tab
- **"Agents running" pulsing badge** in `DetailPanel` header — polls `GET /potentials/{id}/agent-results` every 5s while any result is `pending/running`; disappears when all complete
- **Next Action tab** (`AgentResultTab` with `hideControls=true`) — no Run/Re-run buttons; content is always agent-decided (FRE draft for new leads, meeting prep for meetings)
- **Research / Solution tabs** — have Run Agents + Re-run all buttons; poll every 5s while pending

### Config
```python
AGENTFLOW_BASE_URL  # agentflow API base
AGENTFLOW_API_KEY   # sent as x-api-key header
AGENTFLOW_TRIGGER_CATEGORY  # default: "newEnquiry" (legacy, kept in config but not in payload)
WEBHOOK_API_KEY     # validates incoming webhook + init calls — must be set in .env
```

### Potential Number
- 7-digit zero-padded string stored in `Potential Number` column
- Auto-assigned on creation: `MAX(TRY_CAST([Potential Number] AS INT)) + 1`, zero-padded to 7 digits via `zfill(7)`
- Used as `entity_id` and `data.potential_id` in agentflow payload
- Displayed as `#XXXXXXX` badge in detail panel header (read-only)

---

## New Potential Creation

`NewPotentialModal` → `POST /potentials` → `create_potential()` in `potential_service.py`:
1. Resolves or creates Account (find-or-create by name)
2. Resolves or creates Contact
3. Assigns `potential_number` = next 7-digit number
4. Commits to DB
5. Logs activity
6. Creates `CXQueueItem` in "new-inquiries" folder (title, subtitle=company·contact, preview=description)
7. Calls `init_agents_for_potential` → triggers agentflow
8. Returns full `PotentialDetailResponse`

After creation: UI auto-selects the new deal and opens the Next Action tab. Folder counts refresh via `refreshFolders()`.

**Default stage**: `Open` (from `potentialstageid` table via `/lookups` endpoint)

**Service list**: DB-driven via `GET /lookups` — services from `service` table, sub-services from `Subservices` table. Hardcoded `SERVICES` / `SUB_SERVICES` constants kept as fallbacks only.

**Next Action tab for new inquiries**: `NextActionTab.tsx` wraps the agent result for `tab_type="next_action"`:
- While agent is running: "Preparing FRE Draft" loading state
- When complete: shows the FRE draft as an email preview (To, Subject, Body) with an "Open in Composer" button
- Composer: opens the full `EmailComposer` (TipTap rich text) pre-filled with the agent's subject + body, contact email, send + save-draft buttons
- Subject/body parsed from agent content via `parseFREDraft()` which detects `Subject:` prefix

**Queue view default tab**: when in Queue view mode, clicking any item opens Panel 3 with Next Action as the default tab (`initialTab="action"`).

---

## TabBar Layout

Two groups separated by a vertical divider:

**Base tabs** (always visible, text + icon):
- Next Action · Details · Research · Emails · Solution

**Deal tabs** (icon-only on desktop, tooltip on hover — only shown when `hasDeal=true`):
- Notes · Todos · Files · Timeline

**"Ask AI" pill** (pinned far right via `ml-auto`):
- Violet pill button (`bg-violet-600` active, `bg-violet-50` inactive)
- Activates `"chat"` tab in `DetailTab` union type

---

## Per-Potential AI Chat (`ChatTab.tsx`)

### Overview
Streaming chat with Claude, full deal context rebuilt on every message, persistent history per potential.

### Backend (`api/api/services/chat_service.py`)
- `build_context_prompt(potential_id)` — assembles system prompt: potential fields, contact, account, notes, todos, last 10 emails, completed agent insights. Rebuilt fresh on every message so context is always up to date.
- `stream_chat()` — resolves `potential_number` once, saves user msg, streams Claude via `anthropic` SDK, saves assistant msg. All DB writes use `potential_number` directly (never UUID).
- `generate_suggestions(potential_id)` — asks Claude to generate 5 context-aware questions based on current deal state; returns JSON array.

### Chat history storage
- Table: `CX_ChatMessages`
- `potential_id` column stores the **7-digit `potential_number`**, not the UUID — stable across DB migrations
- `is_active = False` = soft-deleted (clear history)

### API endpoints
- `GET /potentials/{id}/chat/history` — load message history
- `POST /potentials/{id}/chat` — send message, returns SSE stream
- `GET /potentials/{id}/chat/suggestions` — AI-generated question chips for empty state
- `DELETE /potentials/{id}/chat/history` — soft-delete all messages

### SSE protocol (frontend parsing)
```
data: {"type": "searching"}                  # web search triggered
data: {"type": "text", "content": "..."}     # streamed chunk
data: {"type": "done", "message_id": 123}    # stream complete
data: {"type": "error", "message": "..."}    # error
```

### UI features (`ChatTab.tsx`)
- **Empty state**: "Your AI potential co-pilot is ready" + AI-generated suggestion chips (fetched on mount, disabled input while loading — shows "Setting up your conversation…")
- **Streaming**: `fetch` (not axios) with SSE parsing; streaming cursor animation
- **Web search**: Anthropic's `web_search_20250305` tool is enabled — Claude autonomously decides when to search. "🌐 Searching the web…" indicator shown during search. Useful for "latest news about [company]", "competitors", exchange rates, etc.
- **Stop button**: red square replaces send button while streaming; calls `abortRef.current?.abort()`
- **Typing indicator**: bouncing dots shown immediately after sending, before first text/tool/search event
- **Edit & resend**: hover user message → pencil icon; click → fills input + highlights message; on send → truncates messages from that index in local state, sends fresh
- **Clear history**: trash icon in header, confirms before clearing
- **User messages**: slate-100 gray background (matches global chat style)
- **Markdown**: shared `MarkdownBlock` from `components/chat/MarkdownBlock.tsx` — headings (h1-h6), bullet/numbered lists, tables (with escaped-pipe support for `\|`), code blocks, box-drawing diagrams, horizontal rules
- Context rebuilt server-side on every message — no need for client-side cache invalidation

---

## Global Search (`GlobalSearch.tsx`)

- Search input in top bar, 300ms debounce, min 2 chars
- `GET /search?q=<term>` — searches potentials (name, number), accounts (name), contacts (name, email)
- **Scoped to user + direct reports** — uses `get_team_user_ids` to build the allowed owner IDs
- Grouped dropdown: Potentials / Accounts / Contacts sections
- Matching text highlighted in results
- Keyboard navigation: ↑↓ to move, Enter to select, Esc to close
- `onNavigate` callback: potential → potentials view + select deal; account → accounts view + select; contact → navigate to linked account or potential
- **Gotcha**: `Potential` model has no `is_active` column — do not filter on it in search queries

---

## Key Patterns & Gotchas

### SQL Server BIT columns
```python
# CORRECT
.where(CXActivity.is_active == True)

# WRONG — do not use
.where(CXActivity.is_active.is_(True))
```

### Venv
Always activate `api/venv_saleszilla` before running or installing:
```bash
cd api
venv_saleszilla\Scripts\activate   # Windows
pip install <package>
```

### Response mapping
Backend returns `snake_case`. Frontend `api.ts` maps everything to `camelCase`. Never access raw backend field names in components — always go through `api.ts`.

### Token keys
- Access token: `sz_access_token`
- Refresh token: `sz_refresh_token`
- Zustand persist key: `sz-auth-storage`

### MS Graph datetime handling
**Backend** (`routes/calendar.py`): `_graph_dt_to_utc_iso()` converts every Graph `{dateTime, timeZone}` block to an explicit UTC ISO string with `Z`. Handles both IANA names (`Asia/Kolkata`) and Windows-style names (`India Standard Time`) via a mapping table + optional `tzdata` package for full DST support.

**Frontend** (`api.ts`): `toUTCString()` still appends `Z` as a safety net (no-op if the backend already sent `Z`).

**Important**: never use `new Date(isoString)` on a string without `Z` or `+` — it'll be parsed as local time.

### SQL Server `NULLS LAST` not supported
Do NOT use `.nullslast()` in SQLAlchemy order_by clauses — SQL Server throws a syntax error. Just use `.desc()` or `.asc()` and accept the default NULL ordering.

### Agentflow trigger is always unconditional
`_trigger_agentflow` is called regardless of whether `CX_AgentTypeConfig` has rows. Config rows only control insight row creation (UI spinners). The POST to agentflow must always fire.

---

## Testing User

`stephen.rd@flatworldsolutions.com` — use this for all OTP login testing.

---

## Twilio Calling (`CallDialog.tsx`)

### Overview
Browser-based calling via Twilio Client SDK (WebRTC). Sales reps call clients directly from the CRM without switching to a phone. The call button appears in Panel 3's detail header for every potential.

### Setup
- **One-time**: run `python setup_twilio.py` to create API Key + TwiML App programmatically (no Twilio Console access needed). Outputs `TWILIO_API_KEY`, `TWILIO_API_SECRET`, `TWILIO_TWIML_APP_SID` to add to `.env`.
- **Dev environment**: requires ngrok for Twilio webhooks to reach localhost. Set `BASE_URL` to the ngrok URL before running the setup script.
- **Dependencies**: `twilio>=9.0.0` (backend), `@twilio/voice-sdk` (frontend)

### Call flow
1. User clicks "Call" in Panel 3 header → `CallDialog` opens
2. Contacts loaded from `GET /twilio/contacts/{potential_id}` (primary contact first, then account contacts with phones)
3. User selects contact, optionally edits phone number, clicks "Call"
4. Frontend fetches Twilio Access Token → initializes Voice SDK `Device` → `device.connect({To: phone})`
5. Twilio calls `POST /twilio/voice` → backend returns TwiML: `<Dial record="record-from-answer-dual" callerId="{TWILIO_NUMBER}"><Number>{phone}</Number></Dial>`
6. Browser WebRTC ↔ PSTN bridges → call connects
7. **At call start**: `CXCallLog` row is created immediately with `status="in-progress"` so the recording webhook can find it later (fixes race condition where webhook arrives before user clicks "Save & Close")
8. Live status events in dialog: connecting → ringing → in-progress (with duration timer)
9. Mute toggle available during call
10. User hangs up → post-call screen: optional notes + "Save & Close"
11. "Save & Close" **updates** the existing `CXCallLog` row (matched by `twilio_call_sid`) with final duration, status, notes

### Post-call logging
- **Timeline**: `CXActivity` with `activity_type="call_logged"` — description includes contact name, duration, status + call notes if provided
- **Notes tab**: auto-creates a `CXNote` with call summary + notes (only if user typed notes)
- **Files tab**: recording appears as MP3 file (uploaded to GCS by the recording webhook)

### Recording pipeline
1. Twilio processes recording (~5-10s after call ends)
2. `POST /twilio/recording-status` webhook fires
3. Backend responds 200 immediately, then in the same request:
   - Downloads MP3 from Twilio (authenticated)
   - Uploads to GCS as `call_recording_{call_sid}.mp3`
   - Creates `CXFile` row for the recording
   - Updates `CXCallLog.recording_url` + `recording_file_id`
4. Recording appears in the potential's Files tab

### Call log upsert pattern
`create_call_log()` in `twilio_service.py` is called TWICE per call:
- **At call start**: `status="in-progress"`, `duration=0`, no notes → INSERT new row
- **At "Save & Close"**: `status="completed"`, final duration, notes → UPDATE existing row (matched by `twilio_call_sid`)
Timeline activity is only logged on the final save (not at call start) to avoid duplicates.

### Per-potential AI chat context
`build_context_prompt()` in `chat_service.py` now includes:
- **RECENT ACTIVITY** (latest 30 `CXActivity` entries) — captures calls, stage changes, notes, todos, emails, field updates
- **CALL HISTORY** (latest 10 `CXCallLog` entries) — includes contact, duration, status, call notes, transcript (when available)
This means the per-potential "Ask AI" and the global chat's `get_potential_full_context` tool both see call activity immediately.

### Twilio env vars
```
TWILIO_ACCOUNT_SID=ACxxxxx
TWILIO_AUTH_TOKEN=xxxxx
TWILIO_CALLING_NUMBER=+1234567890
TWILIO_API_KEY=SKxxxxx           # Created by setup_twilio.py
TWILIO_API_SECRET=xxxxx          # Created by setup_twilio.py (save immediately, shown once)
TWILIO_TWIML_APP_SID=APxxxxx    # Created by setup_twilio.py
BASE_URL=https://xxx.ngrok-free.app  # Public URL for webhooks (ngrok in dev, real domain in prod)
```

---

## Deployment

- **Dockerfiles**: `api/Dockerfile` (Python 3.12 + ODBC Driver 17 + uvicorn) and `ui/Dockerfile` (Node 20 build → nginx 1.27 serve)
- **Cloud Build**: `cloudbuild.yaml` for automated builds; inline YAML triggers per service
- **Deploy script**: `deploy.sh` for manual CLI deployment
- **UI build arg**: `VITE_API_BASE_URL` must be passed at build time (`--build-arg`) — baked into the JS bundle
- **API port**: 8000; UI port: 8080
- **File downloads**: proxy through API (no signed URLs) — avoids `serviceAccountTokenCreator` IAM requirement
- **GCS**: Cloud Run service account needs `Storage Object Admin` on the bucket; no key file needed
- **SSO redirect URI**: `https://{API_URL}/auth/sso/callback` — forced `https://` on Cloud Run, kept `http://` for localhost
- **SQL migration**: `migrate_cx_tables.sql` — idempotent, covers all 18 CX_ tables
- **Twilio setup**: `python setup_twilio.py` — prompts for app name + BASE_URL, creates API Key + TwiML App programmatically
- **Service list**: hardcoded in `types/index.ts` (`SERVICES` constant) — used in NewPotentialModal and DetailsTab; will point to service table later

---

## Follow-Up Cadence System

### Overview
Automated follow-up scheduling triggered by outbound emails. Cadence: D3 → D5 → D8 → D12 (fixed). Cancelled on client reply. Supports both Salezilla-sent and Outlook-sent emails via sync service webhooks.

### Tables
- **`CX_FollowUpSchedule`** — one row per (potential, day_offset). Status: `pending` → `fired` / `cancelled`. Has `TriggerMessageId` (internetMessageId of outbound that started the series).
- **`CX_AgentDraftHistory`** — append-only audit log. Snapshots agent draft content before overwrite/resolve. Tracks `Resolution` (done/skip/replaced/overwritten).

### Trigger flow
1. **Salezilla sends email** → proactive `start_new_series()` creates D3/D5/D8/D12 rows immediately
2. **Sync service detects outbound** → `POST /webhooks/email-outbound` → idempotency check by `internetMessageId` → skips if series already exists
3. **Client replies** → `POST /webhooks/email-inbound` → cancels pending schedules (scoped by `in_reply_to_message_id` to avoid race conditions) + triggers reply agent
4. **Cloud Scheduler tick** (every 15 min) → `POST /internal/followups/tick` → processes due rows → honors working hours (user timezone) → fires agentflow graph

### Agent trigger categories (CX_AgentTypeConfig.TriggerCategory)
| Category | Tab | When triggered | Graph env var |
|---|---|---|---|
| `newEnquiry` | next_action + research + solution | New potential created | `AGENTFLOW_GRAPH_NEW_POTENTIAL` |
| `followUp` | next_action | FU tick fires | `AGENTFLOW_GRAPH_FOLLOW_UP` |
| `reply` | next_action | Client reply detected | `AGENTFLOW_GRAPH_REPLY` |
| `meeting_brief` | next_action | Meeting detected | `AGENTFLOW_GRAPH_MEETING_BRIEF` |

All categories check `has_research_completed()` — if research missing, adds research agents + category-specific agent. If research exists, only the category-specific agent.

### Next Action tab behavior
- **FRE** (`newEnquiry`): extracts subject from first line, rest is body. Email composer with reply context.
- **Follow-Up** (`followUp`): subject from prior thread (`RE: ...`), entire agent output is body. Shows prior conversation below.
- **Reply** (`reply`): same as follow-up pattern.
- **Meeting Brief** (`meeting_brief`): NOT an email draft. Shows meeting info (title, time, participants, join link, description) + agent content (talking points, research). Skip/Done buttons only.
- Labels adapt: "First Response Draft" / "Follow-Up Draft" / "Reply Draft" / "Meeting Prep"

### Draft separation
- Next Action drafts (`CX_UserEmailDrafts.IsNextAction = true`) are separate from Email tab drafts (`IsNextAction = false`)
- Email tab sends do NOT clear Next Action
- Only Skip/Done/Send-from-NextAction clears Next Action (via `POST /potentials/{id}/next-action/resolve`)

### Folder pipeline
```
New Inquiries → [FRE sent] → Emails Sent → [D3 fires] → Follow Up Active
                                                              ↓ client replies
                                                          Reply (draft ready)
                                                              ↓ user sends reply
                                                          Emails Sent → [D3] → Follow Up → ...
```
- Potentials move between folders via `CXQueueItem` status changes
- `CXQueueItem.potential_id` stores **7-digit potential_number** (not UUID). API response returns UUID via Potential join for frontend navigation.
- **Emails Sent**: no Done/Skip actions (action already taken). Deduplicated — one queue item per potential.
- **Follow Up Active**: stage NOT IN (Sleeping, Contact Later)
- **Follow Up Inactive**: stage IN (Sleeping, Contact Later)
- **Meeting Briefs**: auto-expires 1hr after meeting end time (frontend filter)

---

## Email Threads (Emails Tab)

### Data sources (priority order)
1. **MS Graph** (live) — for threads with a known `conversationId` from Salezilla-sent emails. Fetched via `fetch_thread_by_conversation_id()` using `requests` (not httpx — httpx re-encodes OData $filter URLs breaking base64 conversationIds).
2. **CX_SentEmails** — Salezilla-sent emails (available immediately, no sync lag). Stores `InternetMessageId` + `ThreadId` (conversationId).
3. **CRM_Sales_Sync_Emails** — email sync service captures (Outlook-sent + inbound). Columns: `[Related To]` (PotentialNumber), `[From]`, `[To]`, `CC`, `Subject`, `UniqueBody`, `SentTime`, `ReceivedTime`, `internetMessageID`.
4. **Healing**: sync table emails with `internetMessageID` → resolve via Graph → upgrade to live thread.

### Threading
- Subject-based grouping (strip RE:/FW: prefixes) for non-Graph data
- Graph threads use `conversationId` for accurate grouping
- `is_flat` flag on threads without Graph threading (shows amber info banner)

### Reply flow
- Reply button on each thread → EmailComposer with `replyToThreadId` (conversationId) + `replyToMessageId`
- `send_mail_via_graph` uses `createReply` when thread context provided → threads correctly in client's inbox
- Reply context endpoint (`GET /potentials/{id}/reply-context`) anchors on the most recently **fired** FU schedule's trigger email

### Attachments
- Graph `$expand=attachments($select=id,name,contentType,size)` fetches attachment metadata
- Download via proxy: `GET /potentials/{id}/email-attachment?message_id=...&attachment_id=...`
- Backend fetches from Graph, decodes base64, returns binary with Content-Disposition

### `send_mail_via_graph` returns 3 values
`(message_id, conversation_id, internet_message_id)` — the last is fetched after send via a GET on the draft id. Stored on `CX_SentEmails.InternetMessageId`.

---

## User Settings

- **Settings drawer** — right-side slide-out overlay from avatar dropdown
- Stored on `CX_UserTokens`: `WorkingHoursStart` (HH:MM), `WorkingHoursEnd`, `Timezone` (IANA), `EmailSignature`
- Endpoints: `GET /me/settings`, `PATCH /me/settings`
- Defaults: 09:00–18:00, Asia/Kolkata
- **Email signature**: auto-appended to composer body on mount (part of editable content, not separate section). User can delete per-email.
- **Working hours**: follow-up tick only fires during owner's working hours in their timezone. `tzdata` pip package required on Windows.

---

## Support Email

- **SupportEmailModal** — accessible via LifeBuoy icon in Panel 3 header (every potential)
- Categories: Agent stuck, Research quality, Solution brief, Next action/FRE, Meeting brief, Email sending, AI chat, Call/Twilio, Data correction, Other
- Sends via SendGrid to `SUPPORT_EMAIL_TO` (comma-separated list in env)
- HTML email with potential context (deal #, company, contact, owner, stage, value, service)
- **Auto-surfaced** when agents are stuck >2hrs — amber banner with "Contact Support" button pre-selecting "Agent stuck" category

---

## Lookup Tables (DB-driven lists)

Master data served by `GET /lookups`:
- **Services** — from `service` table (Active=1), 20 entries
- **Sub-services** — from `Subservices` table, grouped by ServiceID → service name map
- **Stages** — from `potentialstageid` table, 19 entries
- **Industries** — distinct from `CompanyEnrichmentData.Industry`, 370+ entries (searchable datalist in UI)

Default stage for new potentials: **"Open"** (was "Pre Qualified")

---

## Meeting Briefs (Updated)

### Architecture change
Meeting briefs now use the **standard queue flow** — `QueuePanel` + `DetailPanel` with all tabs. No more `MeetingBriefsList` / `MeetingBriefOverlay` custom components for rendering.

### Meeting-to-potential binding
`CX_Meetings` table is populated when a meeting is bound to a potential via Rule 2 (contact email) or Rule 3 (domain match). Stores: ms_event_id, potential_id, title, start/end time, location, description (HTML-stripped), `MeetingLink` (Teams/Zoom/Meet URL extracted from event), attendees.

### Agent trigger
Uses `TriggerCategory="meeting_brief"` from config. Same research-check pattern as FU/Reply. Graph: `AGENTFLOW_GRAPH_MEETING_BRIEF`.

### Throttle
- Completed + not stale (< 4hrs) → skip (no re-fire)
- Pending/running within 5 min → skip
- Stale or actioned → re-fire

### Auto-expiry
Frontend filters meetings where `meetingEnd + 1hr` has passed.

### `CX_MeetingBriefDismissals` — DROPPED
Replaced by `CXQueueItem` status changes via `resolve_next_action`.

---

## Terminology

**Always say "potential"** — never "deal" or "deals" in any user-facing text, LLM prompts, or tool descriptions. Internal code variables (`dealId`, `dealName`) are fine. This applies to:
- UI labels, placeholders, button text, form fields
- Per-potential and global AI chat system prompts
- CRM query tool descriptions and categories
- Support email templates
- Error messages

---

## Additional Environment Variables (new)

```
SUPPORT_EMAIL_TO=email1@domain.com,email2@domain.com
AGENTFLOW_GRAPH_FOLLOW_UP=<graph-id>
AGENTFLOW_GRAPH_REPLY=<graph-id>
```

---

## Additional API Routes (new)

| Route | File | Purpose |
|---|---|---|
| `POST /webhooks/email-outbound` | `routes/follow_ups.py` | Sync service → start FU series |
| `POST /webhooks/email-inbound` | `routes/follow_ups.py` | Sync service → cancel FU + trigger reply agent |
| `POST /internal/followups/tick` | `routes/follow_ups.py` | Cloud Scheduler → process due FU rows |
| `GET /lookups` | `routes/lookups.py` | Services, sub-services, stages, industries from DB |
| `POST /support/email` | `routes/support.py` | Send support email via SendGrid |
| `GET /support/categories` | `routes/support.py` | Support issue categories |
| `GET /me/settings` | `routes/emails.py` | User settings (signature, working hours, timezone) |
| `PATCH /me/settings` | `routes/emails.py` | Update user settings |
| `GET /potentials/{id}/email-threads` | `routes/emails.py` | Email threads from sync table + Graph |
| `GET /potentials/{id}/reply-context` | `routes/emails.py` | Thread context for reply composer |
| `GET /potentials/{id}/meeting-info` | `routes/emails.py` | Meeting details from CX_Meetings |
| `GET /potentials/{id}/email-attachment` | `routes/emails.py` | Proxy attachment download from Graph |
| `POST /potentials/{id}/next-action/resolve` | `routes/emails.py` | Skip/Done for Next Action (marks insight actioned) |

---

## Additional Database Tables (new)

| Table | Purpose |
|---|---|
| `CX_FollowUpSchedule` | Follow-up cadence D3/D5/D8/D12 per potential |
| `CX_AgentDraftHistory` | Audit log of agent drafts before overwrite/resolve |
| `CRM_Sales_Sync_Emails` | Email sync service data (view: `VW_CRM_Sales_Sync_Emails`) |
| `service` | Master service list (read-only lookup) |
| `Subservices` | Sub-services grouped by ServiceID (read-only lookup) |
| `potentialstageid` | Potential stage master list (read-only lookup) |
| `CompanyEnrichmentData` | Company enrichment data — `Industry` column used for unique industry list |

### Schema changes to existing tables
- `CX_UserTokens` — added `WorkingHoursStart`, `WorkingHoursEnd`, `Timezone`
- `CX_SentEmails` — added `InternetMessageId`
- `CX_UserEmailDrafts` — added `IsNextAction` (BIT, default 0)
- `CX_AgentTypeConfig` — `TriggerCategory` column drives agent selection (newEnquiry/followUp/reply/meeting_brief)
- `CX_QueueItems` — `PotentialId` now stores 7-digit potential_number (not UUID)
- `CX_Meetings` — added `MeetingLink`; now populated by meeting brief binding logic
- `CX_MeetingBriefDismissals` — **DROPPED** (replaced by CXQueueItem status)

---

## What Is NOT Yet Built

- Mobile responsive polish (basic breakpoints exist, overlay panels not done)
- RAG for uploaded files (files are stored in GCS; vector indexing + pgvector search deferred to future)
- Out-of-app notifications (Slack DM, email digest) for meeting briefs
- Call transcription (recording pipeline built, STT not wired)
- Twilio webhook request signature validation
- `InReplyTo` column on `CRM_Sales_Sync_Emails` (sync team to add — enables stricter FU cancellation matching)
- Smart reply healing (Option X) — search user's mailbox via Graph to thread old flat emails correctly
- Business-day awareness for FU cadence (currently calendar days only)
- Per-service/per-stage configurable FU cadence intervals
