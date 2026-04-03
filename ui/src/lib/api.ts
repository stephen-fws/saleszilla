/**
 * API endpoint functions.
 * Maps snake_case backend responses to camelCase frontend types.
 */

import { publicApi, protectedApi } from "./httpClient";
import type {
  ApiResponse,
  LoginTokens,
  User,
  Folder,
  QueueItem,
  PotentialDeal,
  PotentialFilters,
  AccountSummary,
  AccountFilters,
  AccountDetail,
  AccountDetailContact,
  AccountDetailPotential,
  AccountActivityItem,
  PotentialDetail,
  NoteItem,
  TodoItem,
  TodoStatus,
  AgentResult,
  EmailDraft,
  EmailAttachment,
  ContactSearchResult,
  AccountSearchResult,
} from "@/types";

// ── Auth ────────────────────────────────────────────────────────────────────

export async function sendOTP(email: string): Promise<ApiResponse<{ email: string }>> {
  const res = await publicApi.post("/auth/otp/send", { email });
  return res.data;
}

export async function verifyOTP(email: string, code: string): Promise<ApiResponse<LoginTokens>> {
  const res = await publicApi.post("/auth/otp/verify", { email, code });
  return res.data;
}

export async function getMe(): Promise<ApiResponse<User>> {
  const res = await protectedApi.get("/auth/me");
  return res.data;
}

export async function refreshToken(): Promise<ApiResponse<{ access_token: string }>> {
  const res = await protectedApi.get("/auth/refresh");
  return res.data;
}

// ── Folders & Queue ─────────────────────────────────────────────────────────

export async function getFolders(): Promise<{ folders: Folder[] }> {
  const res = await protectedApi.get("/folders");
  // Backend: ResponseModel<list[FolderItem]> → data is the list
  const raw: Folder[] = res.data.data ?? [];
  return { folders: raw };
}

export async function getQueue(folderType: string): Promise<{ items: QueueItem[] }> {
  const res = await protectedApi.get(`/queue/${folderType}`);
  // Backend: ResponseModel<list[QueueItemResponse]>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: any[] = res.data.data ?? [];
  const items: QueueItem[] = raw.map((r) => ({
    id: String(r.id),
    folderType: r.folder_type ?? folderType,
    title: r.title ?? "",
    subtitle: r.subtitle ?? "",
    preview: r.preview ?? "",
    timeLabel: r.time_label ?? "",
    priority: r.priority ?? null,
    status: r.status ?? "pending",
    sentBy: r.sent_by ?? null,
    companyId: r.account_id ?? "",
    contactId: r.contact_id ?? "",
    dealId: r.potential_id ?? null,
    createdAt: r.created_time ?? "",
  }));
  return { items };
}

export async function completeQueueItem(itemId: string): Promise<void> {
  await protectedApi.post(`/queue-items/${itemId}/complete`);
}

// ── Potentials ──────────────────────────────────────────────────────────────

export async function getPotentials(filters: Partial<PotentialFilters>): Promise<{
  deals: PotentialDeal[];
  filterOptions: { owners: string[]; services: string[]; stages: string[] };
}> {
  const params = new URLSearchParams();
  if (filters.stages?.length) params.set("stages", filters.stages.join(","));
  if (filters.services?.length) params.set("services", filters.services.join(","));
  if (filters.owners?.length) params.set("owners", filters.owners.join(","));
  if (filters.search) params.set("search", filters.search);
  const res = await protectedApi.get(`/potentials?${params}`);
  // Backend: ResponseModel<PotentialListResponse> → data.potentials, data.filter_options
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d: any = res.data.data ?? {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deals: PotentialDeal[] = (d.potentials ?? []).map((r: any) => ({
    id: String(r.id),
    title: r.title ?? "",
    value: r.value ?? 0,
    stage: r.stage ?? "prospect",
    probability: r.probability ?? 0,
    service: r.service ?? null,
    ownerName: r.owner_name ?? null,
    closingDate: r.closing_date ?? null,
    company: {
      id: r.company?.id ?? "",
      name: r.company?.name ?? "",
      industry: r.company?.industry ?? "",
    },
    contact: {
      id: r.contact?.id ?? "",
      name: r.contact?.name ?? "",
      title: r.contact?.title ?? "",
      email: r.contact?.email ?? "",
    },
  }));
  const fo = d.filter_options ?? {};
  return {
    deals,
    filterOptions: {
      owners: fo.owners ?? [],
      services: fo.services ?? [],
      stages: fo.stages ?? [],
    },
  };
}

// ── Potential detail ─────────────────────────────────────────────────────────

export async function getPotentialDetail(id: string): Promise<PotentialDetail> {
  const res = await protectedApi.get(`/potentials/${id}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d: any = res.data.data ?? {};
  const p = d.potential ?? {};
  return {
    id: p.id ?? id,
    title: p.title ?? null,
    value: p.value ?? null,
    stage: p.stage ?? null,
    probability: p.probability ?? null,
    service: p.service ?? null,
    subService: p.sub_service ?? null,
    ownerName: p.owner_name ?? null,
    closingDate: p.closing_date ?? null,
    leadSource: p.lead_source ?? null,
    nextStep: d.next_step ?? null,
    description: d.description ?? null,
    dealType: p.deal_type ?? null,
    dealSize: p.deal_size ?? null,
    createdAt: p.created_time ?? null,
    contact: p.contact
      ? {
          id: p.contact.id ?? "",
          name: p.contact.name ?? null,
          title: p.contact.title ?? null,
          email: p.contact.email ?? null,
          phone: d.contact_phone ?? null,
          mobile: d.contact_mobile ?? null,
        }
      : null,
    company: p.company
      ? {
          id: p.company.id ?? "",
          name: p.company.name ?? null,
          industry: p.company.industry ?? null,
          website: d.company_website ?? null,
          location: d.company_location ?? null,
          employees: d.company_employees ?? null,
          revenue: d.company_revenue ?? null,
          description: d.company_description ?? null,
        }
      : null,
  };
}

// ── Update potential ─────────────────────────────────────────────────────────

export interface UpdatePotentialPayload {
  stage?: string;
  amount?: number;
  probability?: number;
  closing_date?: string;   // YYYY-MM-DD
  next_step?: string;
  description?: string;
}

export async function updatePotential(id: string, payload: UpdatePotentialPayload): Promise<PotentialDetail> {
  const res = await protectedApi.patch(`/potentials/${id}`, payload);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d: any = res.data.data ?? {};
  const p = d.potential ?? {};
  return {
    id: p.id ?? id,
    title: p.title ?? null,
    value: p.value ?? null,
    stage: p.stage ?? null,
    probability: p.probability ?? null,
    service: p.service ?? null,
    subService: p.sub_service ?? null,
    ownerName: p.owner_name ?? null,
    closingDate: p.closing_date ?? null,
    leadSource: p.lead_source ?? null,
    nextStep: d.next_step ?? null,
    description: d.description ?? null,
    dealType: p.deal_type ?? null,
    dealSize: p.deal_size ?? null,
    createdAt: p.created_time ?? null,
    contact: p.contact ? {
      id: p.contact.id ?? "",
      name: p.contact.name ?? null,
      title: p.contact.title ?? null,
      email: p.contact.email ?? null,
      phone: d.contact_phone ?? null,
      mobile: d.contact_mobile ?? null,
    } : null,
    company: p.company ? {
      id: p.company.id ?? "",
      name: p.company.name ?? null,
      industry: p.company.industry ?? null,
      website: d.company_website ?? null,
      location: d.company_location ?? null,
      employees: d.company_employees ?? null,
      revenue: d.company_revenue ?? null,
      description: d.company_description ?? null,
    } : null,
  };
}

// ── Search accounts / contacts for new potential modal ───────────────────────

export async function searchAccounts(q: string): Promise<AccountSearchResult[]> {
  const res = await protectedApi.get("/accounts", { params: { search: q, page_size: 15 } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items: any[] = res.data.data?.accounts ?? [];
  return items.map((a) => ({
    id: a.id ?? "",
    name: a.name ?? "",
    industry: a.industry ?? null,
    website: a.website ?? null,
  }));
}

export async function searchContacts(q: string, accountId?: string): Promise<ContactSearchResult[]> {
  const res = await protectedApi.get("/contacts", { params: { q, account_id: accountId, page_size: 15 } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items: any[] = res.data.data ?? [];
  return items.map((c) => ({
    id: c.id ?? "",
    name: c.name ?? "",
    title: c.title ?? null,
    email: c.email ?? null,
    phone: c.phone ?? null,
    accountId: c.account_id ?? null,
    accountName: c.account_name ?? null,
  }));
}

// ── Create potential ─────────────────────────────────────────────────────────

export interface CreatePotentialPayload {
  // Account: existing ID or new object
  account_id?: string;
  company?: { name: string; industry?: string; website?: string; country?: string };
  // Contact: existing ID or new object
  contact_id?: string;
  contact?: { name: string; title?: string; email?: string; phone?: string };
  potential_name: string;
  amount: number;
  stage?: string;
  probability?: number;
  service?: string;
  sub_service?: string;
  lead_source?: string;
  closing_date?: string;  // YYYY-MM-DD
  next_step?: string;
  description?: string;
  deal_type?: string;
  deal_size?: string;
}

export async function createPotential(payload: CreatePotentialPayload): Promise<PotentialDetail> {
  const res = await protectedApi.post("/potentials", payload);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d: any = res.data.data ?? {};
  const p = d.potential ?? {};
  return {
    id: p.id ?? "",
    title: p.title ?? null,
    value: p.value ?? null,
    stage: p.stage ?? null,
    probability: p.probability ?? null,
    service: p.service ?? null,
    subService: p.sub_service ?? null,
    ownerName: p.owner_name ?? null,
    closingDate: p.closing_date ?? null,
    leadSource: p.lead_source ?? null,
    nextStep: d.next_step ?? null,
    description: d.description ?? null,
    dealType: p.deal_type ?? null,
    dealSize: p.deal_size ?? null,
    createdAt: p.created_time ?? null,
    contact: p.contact ? {
      id: p.contact.id ?? "",
      name: p.contact.name ?? null,
      title: p.contact.title ?? null,
      email: p.contact.email ?? null,
      phone: d.contact_phone ?? null,
      mobile: d.contact_mobile ?? null,
    } : null,
    company: p.company ? {
      id: p.company.id ?? "",
      name: p.company.name ?? null,
      industry: p.company.industry ?? null,
      website: d.company_website ?? null,
      location: d.company_location ?? null,
      employees: d.company_employees ?? null,
      revenue: d.company_revenue ?? null,
      description: d.company_description ?? null,
    } : null,
  };
}

// ── Notes ────────────────────────────────────────────────────────────────────

export async function getNotes(dealId: string): Promise<NoteItem[]> {
  const res = await protectedApi.get(`/potentials/${dealId}/notes`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (res.data.data ?? []).map((r: any): NoteItem => ({
    id: r.id,
    content: r.content ?? "",
    createdTime: r.created_time ?? null,
  }));
}

export async function addNote(dealId: string, content: string): Promise<NoteItem> {
  const res = await protectedApi.post(`/potentials/${dealId}/notes`, { content });
  const r = res.data.data;
  return { id: r.id, content: r.content ?? "", createdTime: r.created_time ?? null };
}

export async function editNote(dealId: string, noteId: number, content: string): Promise<NoteItem> {
  const res = await protectedApi.patch(`/potentials/${dealId}/notes/${noteId}`, { content });
  const r = res.data.data;
  return { id: r.id, content: r.content ?? "", createdTime: r.created_time ?? null };
}

export async function deleteNote(dealId: string, noteId: number): Promise<void> {
  await protectedApi.delete(`/potentials/${dealId}/notes/${noteId}`);
}

// ── Todos ────────────────────────────────────────────────────────────────────

export async function getTodos(dealId: string): Promise<TodoItem[]> {
  const res = await protectedApi.get(`/potentials/${dealId}/todos`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (res.data.data ?? []).map((r: any): TodoItem => ({
    id: r.id,
    text: r.text ?? "",
    status: (r.status ?? "pending") as TodoStatus,
    isCompleted: r.is_completed ?? false,
    createdTime: r.created_time ?? null,
  }));
}

export async function addTodo(dealId: string, text: string): Promise<TodoItem> {
  const res = await protectedApi.post(`/potentials/${dealId}/todos`, { text });
  const r = res.data.data;
  return { id: r.id, text: r.text ?? "", status: (r.status ?? "pending") as TodoStatus, isCompleted: r.is_completed ?? false, createdTime: r.created_time ?? null };
}

export async function updateTodo(dealId: string, todoId: number, status: TodoStatus): Promise<void> {
  await protectedApi.patch(`/potentials/${dealId}/todos/${todoId}`, { status });
}

export async function deleteTodo(dealId: string, todoId: number): Promise<void> {
  await protectedApi.delete(`/potentials/${dealId}/todos/${todoId}`);
}

// ── Files ────────────────────────────────────────────────────────────────────

export interface FileItem {
  id: number;
  fileName: string;
  mimeType: string | null;
  fileSize: number | null;
  createdTime: string | null;
  downloadUrl: string | null;
}

export async function getFiles(dealId: string): Promise<FileItem[]> {
  const res = await protectedApi.get(`/potentials/${dealId}/files`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (res.data.data ?? []).map((r: any): FileItem => ({
    id: r.id,
    fileName: r.file_name ?? "",
    mimeType: r.mime_type ?? null,
    fileSize: r.file_size ?? null,
    createdTime: r.created_time ?? null,
    downloadUrl: r.download_url ?? null,
  }));
}

export async function uploadFile(dealId: string, file: File): Promise<FileItem> {
  const form = new FormData();
  form.append("file", file);
  const res = await protectedApi.post(`/potentials/${dealId}/files`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  const r = res.data.data;
  return {
    id: r.id, fileName: r.file_name ?? "", mimeType: r.mime_type ?? null,
    fileSize: r.file_size ?? null, createdTime: r.created_time ?? null,
    downloadUrl: r.download_url ?? null,
  };
}

export async function deleteFile(dealId: string, fileId: number): Promise<void> {
  await protectedApi.delete(`/potentials/${dealId}/files/${fileId}`);
}

export async function getFileTextContent(dealId: string, fileId: number): Promise<string> {
  const res = await protectedApi.get(`/potentials/${dealId}/files/${fileId}/content`, {
    responseType: "text",
  });
  return res.data as string;
}

export async function getFileBinaryContent(dealId: string, fileId: number): Promise<ArrayBuffer> {
  const res = await protectedApi.get(`/potentials/${dealId}/files/${fileId}/content`, {
    responseType: "arraybuffer",
  });
  return res.data as ArrayBuffer;
}

// ── Accounts ─────────────────────────────────────────────────────────────────

export async function getAccounts(filters: Partial<AccountFilters>): Promise<{
  accounts: AccountSummary[];
  filterOptions: { industries: string[] };
}> {
  const params = new URLSearchParams();
  if (filters.search) params.set("search", filters.search);
  if (filters.industries?.length) params.set("industries", filters.industries.join(","));
  const res = await protectedApi.get(`/accounts?${params}`);
  // Backend: ResponseModel<AccountListResponse> → data.accounts, data.filter_options
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d: any = res.data.data ?? {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const accounts: AccountSummary[] = (d.accounts ?? []).map((r: any) => ({
    id: String(r.id),
    name: r.name ?? "",
    industry: r.industry ?? "",
    location: r.location ?? null,
    website: r.website ?? null,
    dealCount: r.deal_count ?? 0,
    contactCount: r.contact_count ?? 0,
    totalValue: r.total_value ?? 0,
    topStage: r.top_stage ?? null,
  }));
  return {
    accounts,
    filterOptions: { industries: d.filter_options?.industries ?? [] },
  };
}

export async function getAccountDetail(id: string): Promise<AccountDetail> {
  const res = await protectedApi.get(`/accounts/${id}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d: any = res.data.data ?? {};
  return {
    id: d.id ?? id,
    name: d.name ?? null,
    industry: d.industry ?? null,
    website: d.website ?? null,
    location: d.location ?? null,
    billingCity: d.billing_city ?? null,
    billingState: d.billing_state ?? null,
    billingCountry: d.billing_country ?? null,
    employees: d.employees ?? null,
    revenue: d.revenue ?? null,
    description: d.description ?? null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    contacts: (d.contacts ?? []).map((c: any): AccountDetailContact => ({
      id: c.id ?? "",
      name: c.name ?? null,
      title: c.title ?? null,
      email: c.email ?? null,
      phone: c.phone ?? null,
      mobile: c.mobile ?? null,
      department: c.department ?? null,
    })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    potentials: (d.potentials ?? []).map((p: any): AccountDetailPotential => ({
      id: p.id ?? "",
      title: p.title ?? null,
      value: p.value ?? null,
      stage: p.stage ?? null,
      probability: p.probability ?? null,
      service: p.service ?? null,
      ownerName: p.owner_name ?? null,
      contact: p.contact ? { id: p.contact.id ?? "", name: p.contact.name ?? null, title: p.contact.title ?? null } : null,
    })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    activities: (d.activities ?? []).map((a: any): AccountActivityItem => ({
      id: a.id,
      activityType: a.activity_type ?? "",
      description: a.description ?? null,
      createdTime: a.created_time ?? null,
    })),
  };
}

export interface UpdateContactPayload {
  title?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  department?: string;
}

export async function updateContact(contactId: string, payload: UpdateContactPayload): Promise<AccountDetailContact> {
  const res = await protectedApi.patch(`/contacts/${contactId}`, payload);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = res.data.data ?? {};
  return {
    id: c.id ?? contactId,
    name: c.name ?? null,
    title: c.title ?? null,
    email: c.email ?? null,
    phone: c.phone ?? null,
    mobile: c.mobile ?? null,
    department: c.department ?? null,
  };
}

export interface UpdateAccountPayload {
  industry?: string;
  website?: string;
  employees?: number;
  revenue?: number;
  description?: string;
  billing_city?: string;
  billing_state?: string;
  billing_country?: string;
}

export async function updateAccount(id: string, payload: UpdateAccountPayload): Promise<AccountDetail> {
  const res = await protectedApi.patch(`/accounts/${id}`, payload);
  const d = res.data.data ?? {};
  return {
    id: d.id ?? id,
    name: d.name ?? null,
    industry: d.industry ?? null,
    website: d.website ?? null,
    location: d.location ?? null,
    billingCity: d.billing_city ?? null,
    billingState: d.billing_state ?? null,
    billingCountry: d.billing_country ?? null,
    employees: d.employees ?? null,
    revenue: d.revenue ?? null,
    description: d.description ?? null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    contacts: (d.contacts ?? []).map((c: any): AccountDetailContact => ({
      id: c.id ?? "", name: c.name ?? null, title: c.title ?? null,
      email: c.email ?? null, phone: c.phone ?? null, mobile: c.mobile ?? null, department: c.department ?? null,
    })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    potentials: (d.potentials ?? []).map((p: any): AccountDetailPotential => ({
      id: p.id ?? "", title: p.title ?? null, value: p.value ?? null, stage: p.stage ?? null,
      probability: p.probability ?? null, service: p.service ?? null, ownerName: p.owner_name ?? null,
      contact: p.contact ? { id: p.contact.id ?? "", name: p.contact.name ?? null, title: p.contact.title ?? null } : null,
    })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    activities: (d.activities ?? []).map((a: any): AccountActivityItem => ({
      id: a.id, activityType: a.activity_type ?? "", description: a.description ?? null, createdTime: a.created_time ?? null,
    })),
  };
}

// ── Activities ────────────────────────────────────────────────────────────────

export interface ActivityEntry {
  id: number;
  activityType: string;
  description: string | null;
  performedByUserId: string | null;
  performedByName: string | null;
  createdTime: string | null;
}

export async function getActivities(dealId: string): Promise<ActivityEntry[]> {
  const res = await protectedApi.get(`/potentials/${dealId}/activities?limit=200`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (res.data.data ?? []).map((a: any): ActivityEntry => ({
    id: a.id,
    activityType: a.activity_type ?? "",
    description: a.description ?? null,
    performedByUserId: a.performed_by_user_id ?? null,
    performedByName: a.performed_by_name ?? null,
    createdTime: a.created_time ?? null,
  }));
}

// ── Calendar ──────────────────────────────────────────────────────────────────

export interface CalendarAttendee {
  email: string;
  name: string | null;
  type: "required" | "optional";
}

export interface CalendarEvent {
  id: string;
  subject: string;
  bodyPreview: string | null;
  start: string | null;
  end: string | null;
  isAllDay: boolean;
  showAs: string;
  organizerEmail: string | null;
  organizerName: string | null;
  location: string | null;
  isOnlineMeeting: boolean;
  onlineMeetingUrl: string | null;
  isRecurring: boolean;
  attendees: CalendarAttendee[];
}

export interface CalendarEventPayload {
  subject: string;
  start: string;  // ISO datetime string
  end: string;
  timezone?: string;
  location?: string;
  body?: string;
  isOnlineMeeting?: boolean;
  requiredAttendees?: string[];
  optionalAttendees?: string[];
}

/** Ensure datetime strings from the backend are treated as UTC by appending Z if missing. */
function toUTCString(s: string | null | undefined): string | null {
  if (!s) return null;
  return s.endsWith("Z") || s.includes("+") ? s : s + "Z";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapCalendarEvent(e: any): CalendarEvent {
  return {
    id: e.id,
    subject: e.subject ?? "",
    bodyPreview: e.body_preview ?? null,
    start: toUTCString(e.start),
    end: toUTCString(e.end),
    isAllDay: e.is_all_day ?? false,
    showAs: e.show_as ?? "busy",
    organizerEmail: e.organizer_email ?? null,
    organizerName: e.organizer_name ?? null,
    location: e.location ?? null,
    isOnlineMeeting: e.is_online_meeting ?? false,
    onlineMeetingUrl: e.online_meeting_url ?? null,
    isRecurring: e.is_recurring ?? false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    attendees: (e.attendees ?? []).map((a: any) => ({
      email: a.email ?? "",
      name: a.name ?? null,
      type: a.type === "optional" ? "optional" : "required",
    })),
  };
}

export interface PersonResult {
  name: string;
  email: string;
  jobTitle: string | null;
}

export async function searchPeople(query: string): Promise<PersonResult[]> {
  const res = await protectedApi.get(`/calendar/people?q=${encodeURIComponent(query)}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (res.data.data ?? []).map((p: any): PersonResult => ({
    name: p.name ?? "",
    email: p.email ?? "",
    jobTitle: p.job_title ?? null,
  }));
}

export async function getCalendarEvents(weeks = 8): Promise<CalendarEvent[]> {
  const res = await protectedApi.get(`/calendar/events?weeks=${weeks}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: any[] = res.data.data ?? [];
  return raw.map(mapCalendarEvent);
}

export async function createCalendarEvent(payload: CalendarEventPayload): Promise<CalendarEvent> {
  const res = await protectedApi.post("/calendar/events", {
    subject: payload.subject,
    start: payload.start,
    end: payload.end,
    timezone: payload.timezone ?? "UTC",
    location: payload.location ?? null,
    body: payload.body ?? null,
    is_online_meeting: payload.isOnlineMeeting ?? false,
    required_attendees: payload.requiredAttendees ?? [],
    optional_attendees: payload.optionalAttendees ?? [],
  });
  return mapCalendarEvent(res.data.data);
}

export async function updateCalendarEvent(eventId: string, payload: Partial<CalendarEventPayload>): Promise<CalendarEvent> {
  const res = await protectedApi.patch(`/calendar/events/${eventId}`, {
    subject: payload.subject ?? null,
    start: payload.start ?? null,
    end: payload.end ?? null,
    timezone: payload.timezone ?? "UTC",
    location: payload.location ?? null,
    body: payload.body ?? null,
    is_online_meeting: payload.isOnlineMeeting ?? null,
    required_attendees: payload.requiredAttendees ?? null,
    optional_attendees: payload.optionalAttendees ?? null,
  });
  return mapCalendarEvent(res.data.data);
}

export async function deleteCalendarEvent(eventId: string): Promise<void> {
  await protectedApi.delete(`/calendar/events/${eventId}`);
}

// ── Email drafts & send ──────────────────────────────────────────────────────

export async function getEmailDrafts(dealId: string): Promise<EmailDraft[]> {
  const res = await protectedApi.get(`/potentials/${dealId}/drafts`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (res.data.data ?? []).map((r: any): EmailDraft => ({
    id: r.id,
    potentialId: r.potential_id,
    toEmail: r.to_email ?? null,
    toName: r.to_name ?? null,
    ccEmails: r.cc_emails ?? null,
    bccEmails: r.bcc_emails ?? null,
    subject: r.subject ?? null,
    body: r.body ?? null,
    replyToThreadId: r.reply_to_thread_id ?? null,
    replyToMessageId: r.reply_to_message_id ?? null,
    status: r.status,
    createdTime: r.created_time ?? null,
    updatedTime: r.updated_time ?? null,
  }));
}

export async function createEmailDraft(dealId: string, data: Partial<EmailDraft>): Promise<EmailDraft> {
  const res = await protectedApi.post(`/potentials/${dealId}/drafts`, {
    to_email: data.toEmail,
    to_name: data.toName,
    cc_emails: data.ccEmails,
    bcc_emails: data.bccEmails,
    subject: data.subject,
    body: data.body,
    reply_to_thread_id: data.replyToThreadId,
    reply_to_message_id: data.replyToMessageId,
  });
  const r = res.data.data;
  return {
    id: r.id, potentialId: r.potential_id, toEmail: r.to_email ?? null,
    toName: r.to_name ?? null, ccEmails: r.cc_emails ?? null, bccEmails: r.bcc_emails ?? null,
    subject: r.subject ?? null, body: r.body ?? null,
    replyToThreadId: r.reply_to_thread_id ?? null, replyToMessageId: r.reply_to_message_id ?? null,
    status: r.status, createdTime: r.created_time ?? null, updatedTime: r.updated_time ?? null,
  };
}

export async function updateEmailDraft(dealId: string, draftId: number, data: Partial<EmailDraft>): Promise<EmailDraft> {
  const res = await protectedApi.patch(`/potentials/${dealId}/drafts/${draftId}`, {
    to_email: data.toEmail,
    to_name: data.toName,
    cc_emails: data.ccEmails,
    bcc_emails: data.bccEmails,
    subject: data.subject,
    body: data.body,
  });
  const r = res.data.data;
  return {
    id: r.id, potentialId: r.potential_id, toEmail: r.to_email ?? null,
    toName: r.to_name ?? null, ccEmails: r.cc_emails ?? null, bccEmails: r.bcc_emails ?? null,
    subject: r.subject ?? null, body: r.body ?? null,
    replyToThreadId: r.reply_to_thread_id ?? null, replyToMessageId: r.reply_to_message_id ?? null,
    status: r.status, createdTime: r.created_time ?? null, updatedTime: r.updated_time ?? null,
  };
}

export async function deleteEmailDraft(dealId: string, draftId: number): Promise<void> {
  await protectedApi.delete(`/potentials/${dealId}/drafts/${draftId}`);
}

export async function sendEmail(dealId: string, data: {
  toEmail: string;
  toName?: string;
  subject: string;
  body: string;
  cc?: string[];
  bcc?: string[];
  threadId?: string;
  replyToMessageId?: string;
  draftId?: number;
  attachments?: EmailAttachment[];
}): Promise<void> {
  await protectedApi.post(`/potentials/${dealId}/send-email`, {
    to_email: data.toEmail,
    to_name: data.toName,
    subject: data.subject,
    body: data.body,
    cc: data.cc,
    bcc: data.bcc,
    thread_id: data.threadId,
    reply_to_message_id: data.replyToMessageId,
    draft_id: data.draftId,
    attachments: data.attachments?.map(a => ({
      name: a.name,
      content_type: a.contentType,
      content_bytes: a.contentBytes,
    })),
  });
}

export async function getEmailSignature(): Promise<string | null> {
  const res = await protectedApi.get("/me/email-signature");
  return res.data.data?.signature ?? null;
}

export async function saveEmailSignature(signature: string | null): Promise<void> {
  await protectedApi.patch("/me/email-signature", { signature });
}

// ── Agents ──────────────────────────────────────────────────────────────────

export async function getAgentResults(dealId: string, tabType: string): Promise<AgentResult[]> {
  const res = await protectedApi.get(`/potentials/${dealId}/agent-results`, { params: { tab_type: tabType } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (res.data.data ?? []).map((r: any): AgentResult => ({
    id: r.id,
    potentialId: r.potential_id,
    agentId: r.agent_id,
    agentName: r.agent_name,
    tabType: r.tab_type,
    contentType: r.content_type ?? "markdown",
    content: r.content ?? null,
    status: r.status,
    sortOrder: r.sort_order ?? 0,
    triggeredBy: r.triggered_by ?? null,
    triggeredAt: r.triggered_at ?? null,
    completedAt: r.completed_at ?? null,
    errorMessage: r.error_message ?? null,
  }));
}

export async function runAllAgents(dealId: string): Promise<void> {
  await protectedApi.post(`/potentials/${dealId}/agents/run`);
}

export async function triggerAgent(dealId: string, agentId: string): Promise<AgentResult> {
  const res = await protectedApi.post(`/potentials/${dealId}/agents/${agentId}/trigger`);
  const r = res.data.data;
  return {
    id: r.id,
    potentialId: r.potential_id,
    agentId: r.agent_id,
    agentName: r.agent_name,
    tabType: r.tab_type,
    contentType: r.content_type ?? "markdown",
    content: r.content ?? null,
    status: r.status,
    sortOrder: r.sort_order ?? 0,
    triggeredBy: r.triggered_by ?? null,
    triggeredAt: r.triggered_at ?? null,
    completedAt: r.completed_at ?? null,
    errorMessage: r.error_message ?? null,
  };
}
