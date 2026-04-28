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
  SalesTargetSummary,
  GlobalSearchResults,
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

// ── Superadmin ──────────────────────────────────────────────────────────────

import type { AdminUser } from "@/types";

export async function listAdminUsers(): Promise<AdminUser[]> {
  const res = await protectedApi.get("/admin/users");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (res.data.data ?? []).map((u: any): AdminUser => ({
    userId: u.user_id,
    name: u.name ?? "",
    email: u.email ?? "",
    isActive: u.is_active ?? true,
  }));
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
    stage: r.stage ?? null,
    value: r.value ?? null,
    service: r.service ?? null,
    category: r.category ?? null,
  }));
  return { items };
}

export async function completeQueueItem(itemId: string): Promise<void> {
  await protectedApi.post(`/queue-items/${itemId}/complete`);
}

export async function skipQueueItem(itemId: string): Promise<void> {
  await protectedApi.post(`/queue-items/${itemId}/skip`);
}

// ── Potentials ──────────────────────────────────────────────────────────────

export async function getPotentials(filters: Partial<PotentialFilters> & { includeTeam?: boolean }): Promise<{
  deals: PotentialDeal[];
  filterOptions: { owners: string[]; services: string[]; stages: string[] };
}> {
  const params = new URLSearchParams();
  if (filters.stages?.length) params.set("stages", filters.stages.join(","));
  if (filters.services?.length) params.set("services", filters.services.join(","));
  if (filters.owners?.length) params.set("owners", filters.owners.join(","));
  if (filters.search) params.set("search", filters.search);
  if (filters.includeTeam) params.set("include_team", "true");
  if (filters.createdFrom) params.set("created_from", filters.createdFrom);
  if (filters.createdTo) params.set("created_to", filters.createdTo);
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
    category: r.category ?? null,
    createdAt: r.created_time ?? null,
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
    potentialNumber: p.potential_number ?? null,
    category: p.category ?? null,
    title: p.title ?? null,
    value: p.value ?? null,
    stage: p.stage ?? null,
    probability: p.probability ?? null,
    service: p.service ?? null,
    subService: p.sub_service ?? null,
    ownerName: p.owner_name ?? null,
    ownerId: p.owner_id ?? null,
    closingDate: p.closing_date ?? null,
    leadSource: p.lead_source ?? null,
    formUrl: p.form_url ?? null,
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
  title?: string;
  stage?: string;
  amount?: number;
  probability?: number;
  closing_date?: string;   // YYYY-MM-DD
  next_step?: string;
  description?: string;
  service?: string;
  sub_service?: string;
  lead_source?: string;
  form_url?: string;
  deal_type?: string;
  deal_size?: string;
  not_an_inquiry_reason?: string;
  disqualify_reason?: string;
}

export async function updatePotential(id: string, payload: UpdatePotentialPayload): Promise<PotentialDetail> {
  const res = await protectedApi.patch(`/potentials/${id}`, payload);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d: any = res.data.data ?? {};
  const p = d.potential ?? {};
  return {
    id: p.id ?? id,
    potentialNumber: p.potential_number ?? null,
    category: p.category ?? null,
    title: p.title ?? null,
    value: p.value ?? null,
    stage: p.stage ?? null,
    probability: p.probability ?? null,
    service: p.service ?? null,
    subService: p.sub_service ?? null,
    ownerName: p.owner_name ?? null,
    ownerId: p.owner_id ?? null,
    closingDate: p.closing_date ?? null,
    leadSource: p.lead_source ?? null,
    formUrl: p.form_url ?? null,
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
    country: a.country ?? null,
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
  company?: {
    name: string;
    phone?: string;
    industry?: string;
    website?: string;
    billing_street?: string;
    billing_city?: string;
    billing_state?: string;
    billing_code?: string;
    country?: string;
  };
  // Contact: existing ID or new object
  contact_id?: string;
  contact?: {
    name: string;
    first_name?: string;
    last_name?: string;
    title?: string;
    email?: string;
    phone?: string;
  };
  potential_name: string;
  amount: number;
  stage?: string;
  probability?: number;
  service?: string;
  sub_service?: string;
  lead_source?: string;
  form_url?: string;
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
    potentialNumber: p.potential_number ?? null,
    category: p.category ?? null,
    title: p.title ?? null,
    value: p.value ?? null,
    stage: p.stage ?? null,
    probability: p.probability ?? null,
    service: p.service ?? null,
    subService: p.sub_service ?? null,
    ownerName: p.owner_name ?? null,
    ownerId: p.owner_id ?? null,
    closingDate: p.closing_date ?? null,
    leadSource: p.lead_source ?? null,
    formUrl: p.form_url ?? null,
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
    source: (r.source === "agent" ? "agent" : "user"),
    createdTime: r.created_time ?? null,
  }));
}

export async function addTodo(dealId: string, text: string): Promise<TodoItem> {
  const res = await protectedApi.post(`/potentials/${dealId}/todos`, { text });
  const r = res.data.data;
  return {
    id: r.id, text: r.text ?? "",
    status: (r.status ?? "pending") as TodoStatus,
    isCompleted: r.is_completed ?? false,
    source: (r.source === "agent" ? "agent" : "user"),
    createdTime: r.created_time ?? null,
  };
}

export async function updateTodo(dealId: string, todoId: number, fields: { status?: TodoStatus; text?: string }): Promise<void> {
  await protectedApi.patch(`/potentials/${dealId}/todos/${todoId}`, fields);
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
    phone: d.phone ?? null,
    billingStreet: d.billing_street ?? null,
    billingCity: d.billing_city ?? null,
    billingState: d.billing_state ?? null,
    billingCode: d.billing_code ?? null,
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
  name?: string;
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
  name?: string;
  industry?: string;
  website?: string;
  phone?: string;
  employees?: number;
  revenue?: number;
  description?: string;
  billing_street?: string;
  billing_city?: string;
  billing_state?: string;
  billing_code?: string;
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
    phone: d.phone ?? null,
    billingStreet: d.billing_street ?? null,
    billingCity: d.billing_city ?? null,
    billingState: d.billing_state ?? null,
    billingCode: d.billing_code ?? null,
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
  response: "none" | "accepted" | "declined" | "tentativelyAccepted" | "notResponded";
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
      response: a.response ?? "none",
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapDraftAttachments(raw: any): EmailDraft["attachments"] {
  if (!Array.isArray(raw)) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return raw.map((a: any) => ({
    name: a.name ?? "",
    contentType: a.content_type ?? "application/octet-stream",
    contentBytes: a.content_bytes ?? "",
    sizeBytes: a.size_bytes ?? 0,
  }));
}

function encodeDraftAttachments(items: EmailDraft["attachments"]) {
  if (!items) return undefined;
  return items.map((a) => ({
    name: a.name,
    content_type: a.contentType,
    content_bytes: a.contentBytes,
    size_bytes: a.sizeBytes,
  }));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapDraft(r: any): EmailDraft {
  return {
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
    attachments: mapDraftAttachments(r.attachments),
    createdTime: r.created_time ?? null,
    updatedTime: r.updated_time ?? null,
  };
}

export async function getEmailDrafts(dealId: string, isNextAction = false): Promise<EmailDraft[]> {
  const res = await protectedApi.get(`/potentials/${dealId}/drafts`, { params: { is_next_action: isNextAction } });
  return (res.data.data ?? []).map(mapDraft);
}

export async function createEmailDraft(dealId: string, data: Partial<EmailDraft>, isNextAction = false): Promise<EmailDraft> {
  const res = await protectedApi.post(`/potentials/${dealId}/drafts?is_next_action=${isNextAction}`, {
    to_email: data.toEmail,
    to_name: data.toName,
    cc_emails: data.ccEmails,
    bcc_emails: data.bccEmails,
    subject: data.subject,
    body: data.body,
    reply_to_thread_id: data.replyToThreadId,
    reply_to_message_id: data.replyToMessageId,
    attachments: encodeDraftAttachments(data.attachments ?? null),
  });
  return mapDraft(res.data.data);
}

export async function updateEmailDraft(dealId: string, draftId: number, data: Partial<EmailDraft>): Promise<EmailDraft> {
  const res = await protectedApi.patch(`/potentials/${dealId}/drafts/${draftId}`, {
    to_email: data.toEmail,
    to_name: data.toName,
    cc_emails: data.ccEmails,
    bcc_emails: data.bccEmails,
    subject: data.subject,
    body: data.body,
    attachments: encodeDraftAttachments(data.attachments ?? null),
  });
  return mapDraft(res.data.data);
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
  draftAttachmentIds?: number[];
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
    draft_attachment_ids: data.draftAttachmentIds,
  });
}

export async function listDraftAttachments(dealId: string): Promise<import("@/types").DraftAttachment[]> {
  const res = await protectedApi.get(`/potentials/${dealId}/draft-attachments`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (res.data.data ?? []).map((a: any) => ({
    id: a.id,
    filename: a.filename,
    contentType: a.content_type,
    fileSize: a.file_size ?? 0,
    createdTime: a.created_time,
  }));
}

export async function removeDraftAttachment(dealId: string, attachmentId: number): Promise<void> {
  await protectedApi.delete(`/potentials/${dealId}/draft-attachments/${attachmentId}`);
}

/**
 * Fetch a draft attachment's HTML bytes and open it in a new browser tab.
 * Uses a blob URL so the Bearer token doesn't need to be in the navigated URL.
 */
export async function openDraftAttachment(dealId: string, attachmentId: number, contentType = "text/html"): Promise<void> {
  const res = await protectedApi.get(`/potentials/${dealId}/draft-attachments/${attachmentId}/download`, {
    responseType: "blob",
  });
  const blob = new Blob([res.data], { type: contentType });
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener,noreferrer");
  // Don't immediately revoke — the new tab is still loading. Let the browser GC it.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function getEmailThreads(dealId: string): Promise<{ threads: import("@/types").SyncEmailThread[]; totalMessages: number }> {
  const res = await protectedApi.get(`/potentials/${dealId}/email-threads`);
  const d = res.data.data ?? {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const threads = (d.threads ?? []).map((t: any) => ({
    threadKey: t.thread_key ?? "",
    subject: t.subject ?? "",
    lastActivity: t.last_activity ?? null,
    messageCount: t.message_count ?? 0,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    messages: (t.messages ?? []).map((m: any) => ({
      id: m.id,
      fromEmail: m.from_email ?? "",
      toEmail: m.to_email ?? "",
      cc: m.cc ?? null,
      bcc: m.bcc ?? null,
      subject: m.subject ?? "",
      body: m.body ?? null,
      direction: m.direction ?? "received",
      sentTime: m.sent_time ?? null,
      receivedTime: m.received_time ?? null,
      internetMessageId: m.internet_message_id ?? null,
      threadId: m.thread_id ?? null,
      graphMessageId: m.graph_message_id ?? null,
      hasAttachments: m.has_attachments ?? false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      attachments: (m.attachments ?? []).map((a: any) => ({
        id: a.id ?? "",
        name: a.name ?? "attachment",
        contentType: a.content_type ?? "",
        size: a.size ?? 0,
      })),
    })),
    replyThreadId: t.reply_thread_id ?? null,
    replyToMessageId: t.reply_to_message_id ?? null,
    isFlat: t.is_flat ?? false,
  }));
  return { threads, totalMessages: d.total_messages ?? 0 };
}

export async function getAiHighlight(dealId: string): Promise<string | null> {
  try {
    const res = await protectedApi.get(`/potentials/${dealId}/agent-results`, { params: { tab_type: "stage_update" } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results: any[] = res.data.data ?? [];
    if (results.length === 0) return null;
    const latest = results[0];
    if (!latest.content) return null;
    try {
      const parsed = JSON.parse(latest.content);
      return parsed.ai_highlight ?? null;
    } catch { return null; }
  } catch { return null; }
}

export async function downloadEmailAttachment(dealId: string, messageId: string, attachmentId: string, fileName: string): Promise<void> {
  const res = await protectedApi.get(`/potentials/${dealId}/email-attachment`, {
    params: { message_id: messageId, attachment_id: attachmentId },
    responseType: "blob",
  });
  const blob = new Blob([res.data]);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(a.href);
}

export async function resolveNextAction(
  dealId: string,
  action: "done" | "skip" = "done",
  category?: string,  // trigger_category of the insight being resolved (scopes to one folder)
): Promise<void> {
  const params: Record<string, string> = { action };
  if (category) params.category = category;
  await protectedApi.post(`/potentials/${dealId}/next-action/resolve`, null, { params });
}

export interface MeetingInfo {
  title: string;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  description: string | null;
  meetingLink: string | null;
  attendees: string[];
  msEventId: string | null;
}

export async function getMeetingInfo(dealId: string): Promise<MeetingInfo | null> {
  const res = await protectedApi.get(`/potentials/${dealId}/meeting-info`);
  const d = res.data.data;
  if (!d) return null;
  return {
    title: d.title ?? "",
    startTime: d.start_time ?? null,
    endTime: d.end_time ?? null,
    location: d.location ?? null,
    description: d.description ?? null,
    meetingLink: d.meeting_link ?? null,
    attendees: d.attendees ?? [],
    msEventId: d.ms_event_id ?? null,
  };
}

export async function getReplyContext(dealId: string): Promise<{ threadId: string | null; internetMessageId: string | null }> {
  const res = await protectedApi.get(`/potentials/${dealId}/reply-context`);
  const d = res.data.data ?? {};
  return { threadId: d.thread_id ?? null, internetMessageId: d.internet_message_id ?? null };
}

export async function getEmailSignature(): Promise<string | null> {
  const res = await protectedApi.get("/me/email-signature");
  return res.data.data?.signature ?? null;
}

export async function saveEmailSignature(signature: string | null): Promise<void> {
  await protectedApi.patch("/me/email-signature", { signature });
}

// ── Agents ──────────────────────────────────────────────────────────────────

export async function getAgentResults(
  dealId: string,
  tabType: string,
  triggerCategory?: string,  // optional — scopes Next Action rendering to a single folder's category
): Promise<AgentResult[]> {
  const params: Record<string, string> = { tab_type: tabType };
  if (triggerCategory) params.trigger_category = triggerCategory;
  const res = await protectedApi.get(`/potentials/${dealId}/agent-results`, { params });
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
    triggerCategory: r.trigger_category ?? null,
    triggeredBy: r.triggered_by ?? null,
    triggeredAt: r.triggered_at ?? null,
    completedAt: r.completed_at ?? null,
    errorMessage: r.error_message ?? null,
  }));
}

export async function getAllAgentResults(dealId: string): Promise<AgentResult[]> {
  const res = await protectedApi.get(`/potentials/${dealId}/agent-results`);
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
    triggerCategory: r.trigger_category ?? null,
    triggeredBy: r.triggered_by ?? null,
    triggeredAt: r.triggered_at ?? null,
    completedAt: r.completed_at ?? null,
    errorMessage: r.error_message ?? null,
  }));
}

export async function runAllAgents(
  dealId: string,
  options?: { tabTypes?: string[] },
): Promise<void> {
  // tabTypes: optional filter — when set, only configs whose tab_type is in
  // this list get pending insight rows. Research / Solution tabs use this so
  // re-running doesn't create an FRE pending row (which would imply we're
  // about to send the first response email again).
  const params = new URLSearchParams();
  if (options?.tabTypes?.length) {
    params.set("tab_types", options.tabTypes.join(","));
  }
  const qs = params.toString();
  await protectedApi.post(`/potentials/${dealId}/agents/run${qs ? `?${qs}` : ""}`);
}

// ── Chat ────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  createdTime: string | null;
}

export async function getChatHistory(dealId: string): Promise<ChatMessage[]> {
  const res = await protectedApi.get(`/potentials/${dealId}/chat/history`);
  return (res.data.data ?? []).map((m: Record<string, unknown>) => ({
    id: m.id as number,
    role: m.role as "user" | "assistant",
    content: m.content as string,
    createdTime: (m.created_time as string) ?? null,
  }));
}

export async function clearChatHistory(dealId: string): Promise<void> {
  await protectedApi.delete(`/potentials/${dealId}/chat/history`);
}

export async function getChatSuggestions(dealId: string): Promise<string[]> {
  const res = await protectedApi.get<{ data: string[] }>(`/potentials/${dealId}/chat/suggestions`);
  return res.data.data ?? [];
}

// ── Global cross-entity chat ─────────────────────────────────────────────────

export interface GlobalChatConversation {
  id: number;
  title: string | null;
  createdTime: string | null;
  updatedTime: string | null;
  messageCount: number;
  lastMessageTime: string | null;
}

export async function listGlobalConversations(): Promise<GlobalChatConversation[]> {
  const res = await protectedApi.get<{ data: Array<{ id: number; title: string | null; created_time: string | null; updated_time: string | null; message_count: number; last_message_time: string | null }> }>(`/chat/global/conversations`);
  return (res.data.data ?? []).map((c) => ({
    id: c.id,
    title: c.title,
    createdTime: c.created_time,
    updatedTime: c.updated_time,
    messageCount: c.message_count,
    lastMessageTime: c.last_message_time,
  }));
}

export async function createGlobalConversation(): Promise<GlobalChatConversation> {
  const res = await protectedApi.post<{ data: { id: number; title: string | null; created_time: string | null; updated_time: string | null; message_count: number; last_message_time: string | null } }>(`/chat/global/conversations`);
  const c = res.data.data;
  return {
    id: c.id,
    title: c.title,
    createdTime: c.created_time,
    updatedTime: c.updated_time,
    messageCount: c.message_count,
    lastMessageTime: c.last_message_time,
  };
}

export async function deleteGlobalConversation(conversationId: number): Promise<void> {
  await protectedApi.delete(`/chat/global/conversations/${conversationId}`);
}

export async function renameGlobalConversation(conversationId: number, title: string): Promise<void> {
  await protectedApi.patch(`/chat/global/conversations/${conversationId}`, { title });
}

export async function getGlobalConversationMessages(conversationId: number): Promise<ChatMessage[]> {
  const res = await protectedApi.get<{ data: Array<{ id: number; role: string; content: string; created_time: string | null }> }>(`/chat/global/conversations/${conversationId}/messages`);
  return (res.data.data ?? []).map((m) => ({
    id: m.id,
    role: m.role as "user" | "assistant",
    content: m.content,
    createdTime: m.created_time,
  }));
}

export async function globalSearch(q: string): Promise<GlobalSearchResults> {
  const res = await protectedApi.get("/search", { params: { q } });
  const d = res.data.data;
  return {
    potentials: (d.potentials ?? []).map((r: Record<string, unknown>) => ({
      id: r.id as string,
      label: r.label as string,
      sublabel: r.sublabel as string,
      potentialNumber: (r.potential_number as string) ?? null,
    })),
    accounts: (d.accounts ?? []).map((r: Record<string, unknown>) => ({
      id: r.id as string,
      label: r.label as string,
      sublabel: r.sublabel as string,
    })),
    contacts: (d.contacts ?? []).map((r: Record<string, unknown>) => ({
      id: r.id as string,
      label: r.label as string,
      sublabel: r.sublabel as string,
      accountId: (r.account_id as string) ?? null,
      potentialId: (r.potential_id as string) ?? null,
    })),
  };
}

export async function getSalesTargetSummary(): Promise<SalesTargetSummary> {
  const res = await protectedApi.get("/sales/targets/summary");
  const r = res.data.data;
  return {
    periodLabel: r.period_label,
    actuals: r.actuals,
    target: r.target,
    pctOfTarget: r.pct_of_target,
    prevPeriodLabel: r.prev_period_label,
    prevActuals: r.prev_actuals,
    prevTarget: r.prev_target,
    prevPctOfTarget: r.prev_pct_of_target,
    pctChange: r.pct_change,
    topClosed: (r.top_closed ?? []).map((d: Record<string, unknown>) => ({
      companyName: (d.company_name as string) ?? null,
      amount: d.amount as number,
      invoiceDate: (d.invoice_date as string) ?? null,
    })),
  };
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
    triggerCategory: r.trigger_category ?? null,
    triggeredBy: r.triggered_by ?? null,
    triggeredAt: r.triggered_at ?? null,
    completedAt: r.completed_at ?? null,
    errorMessage: r.error_message ?? null,
  };
}

// ── Meeting Briefs ───────────────────────────────────────────────────────────

export interface MeetingBriefAttendee {
  email: string;
  name: string | null;
  domain: string;
}

export interface MeetingBriefSkeleton {
  msEventId: string;
  meetingTitle: string;
  meetingStart: string | null;
  meetingEnd: string | null;
  isOnline: boolean;
  attendees: MeetingBriefAttendee[];
  potential: {
    potentialId: string;
    potentialNumber: string | null;
    name: string | null;
    stage: string | null;
    amount: number | null;
    probability: number | null;
    closingDate: string | null;
    owner: string | null;
  };
  account: { accountId: string | null; name: string | null; industry: string | null; website: string | null } | null;
  contact: { contactId: string | null; name: string | null; title: string | null; email: string | null } | null;
  rollups: { notesCount: number; openTodosCount: number; recentEmails7d: number };
}

export interface MeetingBriefBody {
  status: "pending" | "running" | "completed" | "error";
  content: string | null;
  contentType: string;
  errorMessage: string | null;
  completedAt: string | null;
}

export interface MeetingBriefItem {
  skeleton: MeetingBriefSkeleton;
  brief: MeetingBriefBody;
}

// ── Twilio calling ───────────────────────────────────────────────────────────

export async function getTwilioToken(): Promise<{ token: string; identity: string }> {
  const res = await protectedApi.post<{ data: { token: string; identity: string } }>("/twilio/token");
  return res.data.data;
}

export async function getContactsForCall(potentialId: string): Promise<Array<{
  contactId: string; name: string; title: string | null; email: string | null;
  phone: string | null; mobile: string | null; isPrimary: boolean;
}>> {
  const res = await protectedApi.get<{ data: Array<Record<string, unknown>> }>(`/twilio/contacts/${potentialId}`);
  return (res.data.data ?? []).map((c) => ({
    contactId: c.contact_id as string,
    name: c.name as string,
    title: (c.title as string) ?? null,
    email: (c.email as string) ?? null,
    phone: (c.phone as string) ?? null,
    mobile: (c.mobile as string) ?? null,
    isPrimary: Boolean(c.is_primary),
  }));
}

export async function createCallLog(data: {
  potentialId: string; contactId?: string | null; contactName?: string | null;
  phoneNumber: string; duration: number; status: string;
  twilioCallSid?: string | null; notes?: string | null;
}): Promise<{ id: number; status: string; duration: number }> {
  const res = await protectedApi.post<{ data: { id: number; status: string; duration: number } }>("/twilio/call-log", {
    potential_id: data.potentialId,
    contact_id: data.contactId ?? null,
    contact_name: data.contactName ?? null,
    phone_number: data.phoneNumber,
    duration: data.duration,
    status: data.status,
    twilio_call_sid: data.twilioCallSid ?? null,
    notes: data.notes ?? null,
  });
  return res.data.data;
}

export async function resolveMeetingBrief(msEventId: string, action: "done" | "skip"): Promise<void> {
  await protectedApi.post(`/meetings/briefs/${encodeURIComponent(msEventId)}/resolve`, { action });
}

export async function getUpcomingMeetingBriefs(hoursAhead = 24): Promise<MeetingBriefItem[]> {
  const res = await protectedApi.get<{ data: Array<Record<string, unknown>> }>(
    `/meetings/briefs/upcoming`,
    { params: { hours_ahead: hoursAhead } },
  );
  const items = res.data.data ?? [];
  return items.map((item) => {
    const sk = item.skeleton as Record<string, unknown>;
    const br = item.brief as Record<string, unknown>;
    const pot = (sk.potential ?? {}) as Record<string, unknown>;
    const acc = sk.account as Record<string, unknown> | null;
    const con = sk.contact as Record<string, unknown> | null;
    const rl = (sk.rollups ?? {}) as Record<string, unknown>;
    return {
      skeleton: {
        msEventId: sk.ms_event_id as string,
        meetingTitle: (sk.meeting_title as string) ?? "",
        meetingStart: (sk.meeting_start as string) ?? null,
        meetingEnd: (sk.meeting_end as string) ?? null,
        isOnline: Boolean(sk.is_online),
        attendees: ((sk.attendees as Array<Record<string, unknown>>) ?? []).map((a) => ({
          email: a.email as string,
          name: (a.name as string) ?? null,
          domain: (a.domain as string) ?? "",
        })),
        potential: {
          potentialId: pot.potential_id as string,
          potentialNumber: (pot.potential_number as string) ?? null,
          name: (pot.name as string) ?? null,
          stage: (pot.stage as string) ?? null,
          amount: (pot.amount as number) ?? null,
          probability: (pot.probability as number) ?? null,
          closingDate: (pot.closing_date as string) ?? null,
          owner: (pot.owner as string) ?? null,
        },
        account: acc
          ? {
              accountId: (acc.account_id as string) ?? null,
              name: (acc.name as string) ?? null,
              industry: (acc.industry as string) ?? null,
              website: (acc.website as string) ?? null,
            }
          : null,
        contact: con
          ? {
              contactId: (con.contact_id as string) ?? null,
              name: (con.name as string) ?? null,
              title: (con.title as string) ?? null,
              email: (con.email as string) ?? null,
            }
          : null,
        rollups: {
          notesCount: (rl.notes_count as number) ?? 0,
          openTodosCount: (rl.open_todos_count as number) ?? 0,
          recentEmails7d: (rl.recent_emails_7d as number) ?? 0,
        },
      },
      brief: {
        status: (br.status as MeetingBriefBody["status"]) ?? "pending",
        content: (br.content as string) ?? null,
        contentType: (br.content_type as string) ?? "markdown",
        errorMessage: (br.error_message as string) ?? null,
        completedAt: (br.completed_at as string) ?? null,
      },
    };
  });
}

// ── Lookups (services, sub-services, stages, industries) ──────────────────────

export interface LookupData {
  services: { id: number; name: string }[];
  subServiceMap: Record<string, string[]>;
  stages: string[];
  industries: string[];
}

export async function getLookups(): Promise<LookupData> {
  const res = await protectedApi.get("/lookups");
  const d = res.data.data ?? {};
  return {
    services: d.services ?? [],
    subServiceMap: d.sub_service_map ?? {},
    stages: d.stages ?? [],
    industries: d.industries ?? [],
  };
}

// ── Support email ─────────────────────────────────────────────────────────────

export async function getSupportCategories(): Promise<Record<string, string>> {
  const res = await protectedApi.get("/support/categories");
  return res.data.data ?? {};
}

export async function sendSupportEmail(data: {
  potentialId: string;
  category: string;
  message?: string;
}): Promise<void> {
  await protectedApi.post("/support/email", {
    potential_id: data.potentialId,
    category: data.category,
    message: data.message ?? "",
  });
}

// ── User settings ─────────────────────────────────────────────────────────────

export async function getUserSettings(): Promise<import("@/types").UserSettings> {
  const res = await protectedApi.get("/me/settings");
  const r = res.data.data ?? {};
  return {
    emailSignature: r.email_signature ?? null,
    workingHoursStart: r.working_hours_start ?? null,
    workingHoursEnd: r.working_hours_end ?? null,
    timezone: r.timezone ?? null,
  };
}

export async function updateUserSettings(data: Partial<import("@/types").UserSettings>): Promise<import("@/types").UserSettings> {
  const res = await protectedApi.patch("/me/settings", {
    email_signature: data.emailSignature,
    working_hours_start: data.workingHoursStart,
    working_hours_end: data.workingHoursEnd,
    timezone: data.timezone,
  });
  const r = res.data.data ?? {};
  return {
    emailSignature: r.email_signature ?? null,
    workingHoursStart: r.working_hours_start ?? null,
    workingHoursEnd: r.working_hours_end ?? null,
    timezone: r.timezone ?? null,
  };
}
