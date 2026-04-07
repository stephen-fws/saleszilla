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
│       │   ├── chat.py   # AI chat endpoints (history, stream, suggestions, clear)
│       │   ├── sales.py  # Sales target summary (GET /sales/targets/summary)
│       │   └── search.py # Global search (GET /search?q=)
│       └── services/
│           ├── account_service.py
│           ├── potential_service.py
│           ├── agent_service.py
│           └── chat_service.py  # Context assembly, Claude streaming, message persistence
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
    │       │   ├── FolderPanel.tsx     # Left panel: view toggle + folder list + TargetWidget
    │       │   └── TargetWidget.tsx    # Quarterly revenue target progress bar (bottom of Panel 1)
    │       ├── queue/
    │       │   └── QueuePanel.tsx      # Queue item list (middle panel, queue view)
    │       ├── potentials/
    │       │   ├── PotentialsList.tsx  # Deal cards (middle panel, potentials view)
    │       │   └── NewPotentialModal.tsx # Create new potential modal (default stage: Pre Qualified)
    │       ├── accounts/
    │       │   ├── AccountsList.tsx        # Account cards (middle panel, accounts view)
    │       │   └── AccountDetailPanel.tsx  # Right panel for accounts view
    │       ├── layout/
    │       │   └── GlobalSearch.tsx    # Top bar search (potentials/accounts/contacts, keyboard nav)
    │       ├── detail/
    │       │   ├── DetailPanel.tsx     # Right panel router (potential detail or account detail)
    │       │   ├── TabBar.tsx          # Tabs: base group + icon-only deal group + "Ask AI" violet pill
    │       │   ├── DetailsTab.tsx
    │       │   ├── NotesTab.tsx
    │       │   ├── TodosTab.tsx
    │       │   ├── FilesTab.tsx
    │       │   ├── TimelineTab.tsx
    │       │   ├── AgentResultTab.tsx  # Renders agent results (research/solution/next_action)
    │       │   ├── EmailsTab.tsx
    │       │   └── ChatTab.tsx         # Per-potential AI chat with Claude streaming
    │       └── calendar/
    │           ├── CalendarPanel.tsx   # Full-screen calendar overlay (month/week/day views)
    │           └── EventFormModal.tsx  # Create/edit event modal
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
- `api/.env` — `MSSQL_*`, `JWT_ACCESS_SECRET_KEY`, `JWT_REFRESH_SECRET_KEY`, `AZURE_*`, `GCS_BUCKET_NAME`, `GOOGLE_APPLICATION_CREDENTIALS`, `AGENTFLOW_BASE_URL`, `AGENTFLOW_API_KEY`, `AGENTFLOW_TRIGGER_CATEGORY`, `WEBHOOK_API_KEY`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`

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
| `CX_AgentInsights` | `id` (int) | Agent results per potential — status: pending/running/completed/error |
| `CX_AgentTypeConfig` | `agent_id` (str) | Registry of agents — maps agent_id to tab_type, content_type, sort_order |
| `CX_ChatMessages` | `id` (int) | Per-potential AI chat history — keyed on `potential_id` = **potential_number** (7-digit), not UUID |
| `CX_UserTokens` | — | MS OAuth tokens per user — has `ms_email` field used for sales target view matching |
| `VW_actuals_vs_targets_salescopilot` | — | SQL Server view — daily invoice rows with repeated `targetsamount`; must deduplicate with MAX per day before SUM |

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
| `/sales/targets/summary` | `routes/sales.py` | Quarterly revenue target vs actuals for current user |
| `/search` | `routes/search.py` | Global search across potentials, accounts, contacts |

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
- `GlobalSearch` (centered, `flex-1 justify-center`) — open text search across potentials, accounts, contacts; grouped dropdown results; keyboard navigation (↑↓ Enter Esc); clicking result navigates to the right panel
- Calendar button + user avatar dropdown (right-aligned, `ml-auto`)
- User avatar dropdown (initials, name, email, Sign Out)

### State management
- `useAuthStore` (Zustand, persisted) — user object + isAuthenticated
- All other state is local `useState` in `DashboardPage` (selected deal/account IDs, view mode, filters, etc.)
- `newDealInitialTab` — set to `"action"` after new potential created; resets tab in DetailPanel to Next Action automatically

### HTTP client (`lib/httpClient.ts`)
- `publicApi` — no auth (login endpoints)
- `protectedApi` — auto Bearer token + 401→refresh interceptor

### API layer (`lib/api.ts`)
- All backend `snake_case` fields mapped to frontend `camelCase`
- **MS Graph datetime fix**: backend returns UTC datetimes without `Z` suffix; `toUTCString()` appends `Z` before passing to `new Date()` to prevent incorrect local-time parsing
- All functions throw on non-2xx (Axios default); callers catch as needed

---

## Calendar Feature

- MS Graph backed via `core/ms_graph.py`
- **Required scopes**: `Calendars.ReadWrite`, `Mail.Send`, `People.Read`, `offline_access`
- `People.Read` needed for attendee autocomplete search (`GET /me/people?$search=...`)
- **OData `$` params**: must NOT be URL-encoded — build raw URL string (`?$search=query`), not httpx `params` dict (which encodes `$` → `%24`)
- **Timezone**: event creation uses browser's IANA timezone (`Intl.DateTimeFormat().resolvedOptions().timeZone`) passed as `timezone` field to backend/Graph
- **Cross-midnight events**: `EventFormModal` tracks `endDate` separately from `date`; auto-advances to next day when end time ≤ start time using `timeToMinutes()` for numeric comparison (avoids string comparison bugs like `"23:15" >= "00:15"` being true)
- **New event default time**: rounds current time up to next 30-minute boundary
- **After create/delete**: 2-second delay before refreshing next meeting (MS Graph propagation lag)
- **Attendee search**: debounced 300ms, min 2 chars, keyboard navigation (↑↓ Enter Esc), gracefully handles 403 (People.Read not consented)

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
- **Description** — textarea, Shift+Enter to save, URLs auto-linked via `LinkifiedText`

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

Stage and Service filters are **dynamically populated from the DB** via `filter_options` returned by `GET /potentials`. Never hardcoded.

- `getPotentials()` returns `filterOptions: { owners, services, stages }`
- `FolderPanel` receives `filterOptions` prop; renders stage checkboxes only when `filterOptions.stages.length > 0`
- Stage names displayed as-is from DB (no normalisation)

---

## Queue Folders

7 active folders (defined in `queue_service.py`):
1. **New Leads** — Recently assigned potentials with no prior activity
2. **Follow Up** — Potentials awaiting follow-up after activity
3. **Proposals Due** — Proposals stage, closing date approaching
4. **Awaiting Response** — Email sent, no reply yet
5. **Hot Deals** — High probability, high value
6. **Meetings Today** — Potentials with meetings scheduled today
7. **Stale Deals** — No activity in 14+ days

`Change Strategy` folder is explicitly ignored/excluded.

---

## Agent System Integration

### Overview
External agentflow system processes potentials and pushes results back. Salezilla triggers it and receives results via webhook.

### Tables
- **`CX_AgentTypeConfig`** — registry of agents. Each row: `agent_id`, `agent_name`, `tab_type` (research/solution_brief/next_action), `content_type` (markdown/html), `sort_order`, `is_active`
- **`CX_AgentInsights`** — results per potential per agent. Status: `pending` → `completed` / `error`

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
    "customer_requirements": "..."
  }
}
```
Headers: `x-api-key: AGENTFLOW_API_KEY`
URL: `AGENTFLOW_BASE_URL/webhooks/crm`

### Webhook receive (agentflow → Salezilla)
`POST /agents/webhook` — content delivered inline in payload (no secondary fetch):
```json
{ "agent_id": "...", "external_id": "<potential_id>", "status": "completed", "content": "...", "content_type": "markdown" }
```
Matched to `CX_AgentTypeConfig` by `agent_id`. Unknown agent_ids are ignored.

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
6. Calls `init_agents_for_potential` → triggers agentflow
7. Returns full `PotentialDetailResponse`

After creation: UI auto-selects the new deal and opens the Next Action tab.

**Default stage**: `Pre Qualified` (set in both initial state and useEffect reset in `NewPotentialModal`)

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
data: {"type": "text", "content": "..."}   # streamed chunk
data: {"type": "done", "message_id": 123}   # stream complete
data: {"type": "error", "message": "..."}   # error
```

### UI features (`ChatTab.tsx`)
- **Empty state**: "Your AI potential co-pilot is ready" + AI-generated suggestion chips (fetched on mount, disabled input while loading)
- **Streaming**: `fetch` (not axios) with SSE parsing; streaming cursor animation
- **Stop button**: red square replaces send button while streaming; calls `abortRef.current?.abort()`
- **Edit & resend**: hover user message → pencil icon; click → fills input + highlights message; on send → truncates messages from that index in local state, sends fresh
- **Clear history**: trash icon in header, confirms before clearing
- Context rebuilt server-side on every message — no need for client-side cache invalidation

---

## Global Search (`GlobalSearch.tsx`)

- Search input in top bar, 300ms debounce, min 2 chars
- `GET /search?q=<term>` — searches potentials (name, number), accounts (name), contacts (name, email)
- Grouped dropdown: Potentials / Accounts / Contacts sections
- Matching text highlighted in results
- Keyboard navigation: ↑↓ to move, Enter to select, Esc to close
- `onNavigate` callback: potential → potentials view + select deal; account → accounts view + select; contact with accountId → accounts view + select account; contact with potentialId → potentials view + select deal
- **Gotcha**: `Potential` model has no `is_active` column — do not filter on it in search queries

---

## Quarterly Target Widget (`TargetWidget.tsx`)

- Shown at the bottom of Panel 1 (`FolderPanel`), outside the scrollable area
- `GET /sales/targets/summary` — resolves user's MS email via `CX_UserTokens.ms_email` (fallback: login email), queries `VW_actuals_vs_targets_salescopilot` for current quarter
- **Deduplication**: `targetsamount` repeats for every invoice row on same date — use `MAX(targetsamount) per day` then SUM daily targets
- Progress bar color: red (<50%) → amber (50–75%) → blue (75–99%) → green (≥100%)
- Trending arrow + % change vs previous quarter
- Click → modal with top 10 highest daily revenue totals

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

### MS Graph datetime strings
Graph returns datetimes like `"2026-04-02T14:30:00"` (no `Z`). JavaScript's `new Date()` parses these as **local time**, not UTC. Always append `Z`:
```typescript
function toUTCString(s: string | null | undefined): string | null {
  if (!s) return null;
  return s.endsWith("Z") || s.includes("+") ? s : s + "Z";
}
```
Applied in `mapCalendarEvent()` for all start/end fields.

### Agentflow trigger is always unconditional
`_trigger_agentflow` is called regardless of whether `CX_AgentTypeConfig` has rows. Config rows only control insight row creation (UI spinners). The POST to agentflow must always fire.

---

## Testing User

`stephen.rd@flatworldsolutions.com` — use this for all OTP login testing.

---

## What Is NOT Yet Built

- Dialer modal
- Mobile responsive polish (basic breakpoints exist, overlay panels not done)
- RAG for uploaded files (files are stored in GCS; vector indexing + pgvector search deferred to future)
