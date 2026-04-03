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
│   │   ├── config.py     # Env vars (MSSQL_*, JWT_*, AZURE_*, GCS_*)
│   │   ├── database.py   # SQLAlchemy engine + session (SQL Server via pyodbc)
│   │   ├── models.py     # ORM models (Account, Contact, Potential, CXActivity, User, …)
│   │   ├── schemas.py    # Pydantic request/response models
│   │   ├── auth.py       # JWT decode, get_current_active_user dependency
│   │   ├── ms_graph.py   # Microsoft Graph API helpers (calendar, people search, tokens)
│   │   └── exceptions.py # BotApiException
│   └── api/
│       ├── routes/       # One file per resource (auth, potentials, accounts, contacts, …)
│       └── services/
│           ├── account_service.py
│           └── potential_service.py
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
    │       │   └── FolderPanel.tsx     # Left panel: view toggle + folder list
    │       ├── queue/
    │       │   └── QueuePanel.tsx      # Queue item list (middle panel, queue view)
    │       ├── potentials/
    │       │   └── PotentialsList.tsx  # Deal cards (middle panel, potentials view)
    │       ├── accounts/
    │       │   ├── AccountsList.tsx        # Account cards (middle panel, accounts view)
    │       │   └── AccountDetailPanel.tsx  # Right panel for accounts view
    │       ├── detail/
    │       │   ├── DetailPanel.tsx     # Right panel router (potential detail or account detail)
    │       │   ├── TabBar.tsx
    │       │   ├── DetailsTab.tsx
    │       │   ├── NotesTab.tsx
    │       │   ├── TodosTab.tsx
    │       │   └── FilesTab.tsx
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
- `api/.env` — `MSSQL_*`, `JWT_ACCESS_SECRET_KEY`, `JWT_REFRESH_SECRET_KEY`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID`, `GCS_BUCKET_NAME`, `GOOGLE_APPLICATION_CREDENTIALS`

---

## Database

SQL Server database: **CRMSalesPotentialls**

Key tables (ORM models in `api/core/models.py`):
| Table | Primary Key | Notes |
|---|---|---|
| `Accounts` | `account_id` (str) | Company data, billing address, industry |
| `Contacts` | `contact_id` (str) | Linked to Account, has title/email/phone/mobile/department |
| `Potentials` | `potential_id` (str) | Deals — linked to Account + Contact, has stage/amount/probability |
| `CXActivities` | `id` (int) | Activity log — linked to Account + Potential, `is_active` BIT |
| `Users` | `user_id` (str) | App users, OTP login, MS OAuth tokens stored here |

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
| `/agents` | `routes/agents.py` | Agent insight requests + webhook |
| `/emails` | `routes/emails.py` | Draft + send via MS Graph |
| `/calendar/events` | `routes/calendar.py` | MS Graph calendar CRUD |
| `/calendar/people` | `routes/calendar.py` | MS Graph people search |
| `/chat` | `routes/chat.py` | AI chat messages |

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
- Next upcoming meeting pill (refreshes every 5 min, ticks every 1 min, shows meetings within 8 hours; uses MS Graph)
- Calendar button (opens `CalendarPanel` full-screen overlay)
- User avatar dropdown (initials, name, email, Sign Out)

### State management
- `useAuthStore` (Zustand, persisted) — user object + isAuthenticated
- All other state is local `useState` in `DashboardPage` (selected deal/account IDs, view mode, filters, etc.)

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

## Account Detail Panel (`AccountDetailPanel.tsx`)

4-tab panel shown in right column when an account is selected:
- **Overview** — stats grid (potentials, pipeline value, contacts), closed-won banner, editable company fields
- **Contacts** — contact cards with editable fields, quick email/phone links, associated potentials per contact
- **Potentials** — clickable cards; clicking navigates to potential detail via `onPotentialNavigate`
- **Activity** — timeline of `CXActivities` with type-based icons

### Inline editing
`EditableField` component: hover → pencil icon → click → inline input. Enter/blur commits, Escape cancels. Saving calls backend PATCH and updates local state optimistically.

**Account fields** (editable): industry, website, employees, revenue, billing city/state/country, description
→ `PATCH /accounts/{id}` → `update_account()` service → returns full `AccountDetailResponse`

**Contact fields** (editable): title, email, phone, mobile, department
→ `PATCH /contacts/{contact_id}` → `patch_contact()` route → returns `AccountDetailContact`

---

## Potential Detail Panel (`DetailsTab.tsx`)

3-section panel (Deal / Contact / Company) in the right column when a potential is selected.

### Editable fields (inline, hover to reveal pencil)
- **Stage** — clickable color badge → `<select>` dropdown with real DB stage names
- **Value** (`amount`) — number input
- **Probability** — number input, validated `0–100` (shows inline red error if exceeded, field stays open)
- **Closing Date** — date picker (`<input type="date">`)
- **Next Step** — text input (full width)
- **Description** — textarea with `resize-y` (user drags to expand); Shift+Enter to save, Escape to cancel; URLs in read-only view rendered as clickable `<a>` links via `LinkifiedText`

### Read-only fields
Title, Owner, Service, Sub-service, Type, Deal Size, Lead Source, Created date

→ `PATCH /potentials/{id}` → `update_potential()` service → returns full `PotentialDetailResponse`

### `UpdatePotentialRequest` schema fields
`stage`, `amount`, `probability`, `closing_date` (ISO date string `YYYY-MM-DD`), `next_step`, `description`

### Extra fields surfaced (were in DB but not previously shown)
- `deal_type` — maps from `Potential.type` column
- `deal_size` — maps from `Potential.deal_size` column
- `created_time` — deal creation date (shown as "Created" label)

### Stage color map
`DetailsTab` and `AccountDetailPanel` both have `STAGE_COLORS` covering real Zoho-style DB names (Prospects, Pre Qualified, Requirements Capture, Proposal, Contracting, Closed, Contact Later, Sleeping, Low Value, Disqualified, Lost) plus normalized mock names as fallback.

---

## Potentials Filter Sidebar (Panel 1)

Stage and Service filters are **dynamically populated from the DB** via `filter_options` returned by `GET /potentials`. Never hardcoded.

- `getPotentials()` returns `filterOptions: { owners, services, stages }` — all three come from `PotentialFilterOptions` on the backend
- `FolderPanel` receives `filterOptions` prop with `stages` included; renders stage checkboxes only when `filterOptions.stages.length > 0`
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
This is applied in `mapCalendarEvent()` for all start/end fields.

---

## Testing User

`stephen.rd@flatworldsolutions.com` — use this for all OTP login testing.

---

## What Is NOT Yet Built

- Detail panel tabs: Research, Solution, Email Thread, Next Action (stubs exist, not wired)
- Chat panel (backend route exists, UI not built)
- Dialer modal
- Email composer modal
- Mobile responsive polish (basic breakpoints exist, overlay panels not done)
- Agent insight display in detail panel
