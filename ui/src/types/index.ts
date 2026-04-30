export interface User {
  id: string;
  email: string;
  name: string;
  role: string | null;
  is_active: boolean;
  is_ms_connected: boolean;
  ms_email: string | null;
  is_super_admin: boolean;
}

export interface AdminUser {
  userId: string;
  name: string;
  email: string;
}

export interface ApiResponse<T> {
  status: string;
  message_code: string | null;
  message: string | null;
  data: T;
}

export interface LoginTokens {
  access_token: string;
  refresh_token: string;
}

// ── Dashboard types ──────────────────────────────────────────────────────────

export type ViewMode = "queue" | "potentials" | "accounts";

export interface Folder {
  id: string;
  label: string;
  count: number;
  icon: string;
}

export interface QueueItem {
  id: string;
  folderType: string;
  title: string;
  subtitle: string;
  preview: string;
  timeLabel: string;
  priority: string | null;
  status: string;
  sentBy: string | null;
  companyId: string;
  contactId: string;
  dealId: string | null;
  potentialNumber: string | null;
  createdAt: string;
  // Potential fields — present for all non-meeting-briefs folders
  stage: string | null;
  value: number | null;
  service: string | null;
  category: string | null;
}

export interface PotentialDeal {
  id: string;
  potentialNumber: string | null;
  title: string;
  value: number;
  stage: string;
  probability: number;
  service: string | null;
  ownerName: string | null;
  closingDate: string | null;
  category: string | null;
  createdAt: string | null;
  company: { id: string; name: string; industry: string };
  contact: { id: string; name: string; title: string; email: string };
}

export interface PotentialFilters {
  stages: string[];
  services: string[];
  owners: string[];
  // Diamond / Platinum category flags. Empty = show all.
  categories: string[];
  search: string;
  sortBy: string;
  // Optional Created Time range filters — ISO YYYY-MM-DD strings (inclusive).
  createdFrom: string | null;
  createdTo: string | null;
}

export interface AccountSummary {
  id: string;
  name: string;
  industry: string;
  location: string | null;
  website: string | null;
  dealCount: number;
  contactCount: number;
  totalValue: number;
  topStage: string | null;
}

export interface AccountFilters {
  search: string;
  industries: string[];
  sortBy: string;
}

export interface AccountDetailContact {
  id: string;
  name: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  department: string | null;
}

export interface AccountDetailPotential {
  id: string;
  title: string | null;
  value: number | null;
  stage: string | null;
  probability: number | null;
  service: string | null;
  ownerName: string | null;
  contact: { id: string; name: string | null; title: string | null } | null;
}

export interface AccountActivityItem {
  id: number;
  activityType: string;
  description: string | null;
  createdTime: string | null;
}

export interface AccountDetail {
  id: string;
  name: string | null;
  industry: string | null;
  website: string | null;
  location: string | null;
  phone: string | null;
  billingStreet: string | null;
  billingCity: string | null;
  billingState: string | null;
  billingCode: string | null;
  billingCountry: string | null;
  employees: number | null;
  revenue: number | null;
  description: string | null;
  contacts: AccountDetailContact[];
  potentials: AccountDetailPotential[];
  activities: AccountActivityItem[];
}

export const DEAL_STAGES = [
  "prospect",
  "qualification",
  "proposal",
  "negotiation",
  "closed-won",
  "closed-lost",
] as const;

// ── Filter sidebar predefined lists ───────────────────────────────────────────
// TODO: Replace with a lookup table from the DB when ready.

export const FILTER_STAGES = [
  "Prospects",
  "Pre Qualified",
  "Requirements Capture",
  "Proposal",
  "Contracting",
  "Closed",
  "Contact Later",
  "Sleeping",
  "Low Value",
  "Disqualified",
  "Lost",
] as const;

export const FILTER_SERVICES = [
  "Data Entry",
  "Finance & Accounting",
  "Healthcare BPO",
  "Customer Support",
  "IT Services",
  "Digital Marketing",
  "Legal Process Outsourcing",
  "Research & Analytics",
] as const;

export const SORT_OPTIONS = [
  { value: "created-desc", label: "Newest First" },
  { value: "created-asc", label: "Oldest First" },
  { value: "value-desc", label: "Value (High \u2192 Low)" },
  { value: "value-asc", label: "Value (Low \u2192 High)" },
  { value: "closing-date", label: "Closing Date (Soonest)" },
  { value: "stage", label: "Stage (Pipeline Order)" },
  { value: "company-az", label: "Company (A \u2192 Z)" },
] as const;

export const ACCOUNT_SORT_OPTIONS = [
  { value: "name-az", label: "Name (A \u2192 Z)" },
  { value: "name-za", label: "Name (Z \u2192 A)" },
  { value: "value-desc", label: "Value (High \u2192 Low)" },
  { value: "deals-desc", label: "Most Deals" },
] as const;

export interface ContactSearchResult {
  id: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  accountId: string | null;
  accountName: string | null;
}

export interface AccountSearchResult {
  id: string;
  name: string;
  industry: string | null;
  website: string | null;
  country: string | null;
}

// ── Detail panel types ────────────────────────────────────────────────────────

export interface EmailDraft {
  id: number;
  potentialId: string;
  toEmail: string | null;
  toName: string | null;
  ccEmails: string[] | null;
  bccEmails: string[] | null;
  subject: string | null;
  body: string | null;
  replyToThreadId: string | null;
  replyToMessageId: string | null;
  status: string;
  // User-uploaded attachments persisted with the draft (Save Draft).
  // Distinct from agent-generated PDF attachments (DraftAttachment).
  attachments: EmailAttachment[] | null;
  createdTime: string | null;
  updatedTime: string | null;
}

export interface EmailAttachment {
  name: string;
  contentType: string;
  contentBytes: string; // base64
  sizeBytes: number;    // for display only
}

export interface DraftAttachment {
  id: number;
  filename: string;
  contentType: string;
  fileSize: number;
  createdTime: string;
}

export interface AgentResult {
  id: number;
  potentialId: string;
  agentId: string;
  agentName: string;
  tabType: string;
  contentType: string;
  content: string | null;
  status: string; // "pending" | "completed" | "error"
  sortOrder: number;
  triggerCategory: string | null;
  triggeredBy: string | null;
  triggeredAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
}

export type DetailTab = "action" | "details" | "research" | "emails" | "solution" | "notes" | "todos" | "files" | "timeline" | "chat";

export interface NoteItem {
  id: number;
  content: string;
  createdTime: string | null;
}

export type TodoStatus = "pending" | "in_progress" | "on_hold" | "done";

export interface TodoItem {
  id: number;
  text: string;
  status: TodoStatus;
  isCompleted: boolean;
  source: "user" | "agent";
  createdTime: string | null;
}

export interface PotentialDetail {
  id: string;
  potentialNumber: string | null;
  category: string | null;
  title: string | null;
  value: number | null;
  stage: string | null;
  probability: number | null;
  service: string | null;
  subService: string | null;
  ownerName: string | null;
  ownerId: string | null;  // user_id of the potential owner — UI compares against current user to gate write actions
  closingDate: string | null;
  leadSource: string | null;
  formUrl: string | null;
  nextStep: string | null;
  description: string | null;
  dealType: string | null;
  dealSize: string | null;
  createdAt: string | null;
  contact: {
    id: string;
    name: string | null;
    title: string | null;
    email: string | null;
    phone: string | null;
    mobile: string | null;
  } | null;
  company: {
    id: string;
    name: string | null;
    industry: string | null;
    website: string | null;
    location: string | null;
    employees: number | null;
    revenue: number | null;
    description: string | null;
  } | null;
}

// ── Global search ─────────────────────────────────────────────────────────────

export interface GlobalSearchPotential {
  id: string;
  label: string;
  sublabel: string;
  potentialNumber: string | null;
}

export interface GlobalSearchAccount {
  id: string;
  label: string;
  sublabel: string;
}

export interface GlobalSearchContact {
  id: string;
  label: string;
  sublabel: string;
  accountId: string | null;
  potentialId: string | null;
}

export interface GlobalSearchResults {
  potentials: GlobalSearchPotential[];
  accounts: GlobalSearchAccount[];
  contacts: GlobalSearchContact[];
}

// ── Hardcoded service list (will point to service table later) ────────────────

// Hardcoded fallback values used when the /lookups endpoint hasn't returned
// yet (or fails). Server-side lookups remain the source of truth — these
// just keep the dropdowns populated on first paint.
export const LEAD_SOURCES = [
  "Cold Call",
  "Cold Email",
  "Cross Selling",
  "Email from Website",
  "Phone Call Internal",
  "Reference",
  "Repeat Business",
  "Website",
  "Chat from website",
  "Email Marketing",
  "Phone call from website",
  "Social Media",
  "Affiliates",
  "Referral by Boyne",
  "Trade Shows",
  "Upselling",
  "Similar Customers",
  "ABM",
];

export const DEAL_TYPES = ["New Business", "Existing Business"];

export const SERVICES = [
  "Data Entry",
  "Finance & Accounting",
  "Healthcare BPO",
  "Customer Support",
  "IT Services",
  "Digital Marketing",
  "Legal Process Outsourcing",
  "Research & Analytics",
];

// ── Twilio calling ────────────────────────────────────────────────────────────

export interface ContactForCall {
  contactId: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  isPrimary: boolean;
}

export type CallState = "idle" | "fetching-token" | "connecting" | "ringing" | "in-progress" | "completed" | "failed";

// ── Email threads ─────────────────────────────────────────────────────────────

export interface SyncEmailAttachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
}

export interface SyncEmailMessage {
  id: number;
  fromEmail: string;
  toEmail: string;
  cc: string | null;
  bcc: string | null;  // populated only for user-sent items from Graph; null for received
  subject: string;
  body: string | null;
  direction: "sent" | "received";
  sentTime: string | null;
  receivedTime: string | null;
  internetMessageId: string | null;
  threadId: string | null;
  graphMessageId: string | null;
  hasAttachments: boolean;
  attachments: SyncEmailAttachment[];
}

export interface SyncEmailThread {
  threadKey: string;
  subject: string;
  messages: SyncEmailMessage[];
  lastActivity: string | null;
  messageCount: number;
  replyThreadId: string | null;       // MS Graph conversationId for threading
  replyToMessageId: string | null;    // internetMessageId for reply-to
  isFlat: boolean;                    // true = legacy data, no Graph threading
}

// ── User settings ─────────────────────────────────────────────────────────────

export interface UserSettings {
  emailSignature: string | null;
  workingHoursStart: string | null;   // "09:00"
  workingHoursEnd: string | null;     // "18:00"
  timezone: string | null;            // IANA, e.g. "Asia/Kolkata"
  twilioNumber: string | null;        // personal Twilio number, E.164
  twilioDefaultNumber: string | null; // org default (read-only echo)
}

export const COMMON_TIMEZONES: { value: string; label: string }[] = [
  { value: "Asia/Kolkata",         label: "Asia/Kolkata — India Standard Time" },
  { value: "Asia/Dubai",           label: "Asia/Dubai — Gulf Standard Time" },
  { value: "Asia/Singapore",       label: "Asia/Singapore — Singapore Time" },
  { value: "Asia/Shanghai",        label: "Asia/Shanghai — China Standard Time" },
  { value: "Asia/Tokyo",           label: "Asia/Tokyo — Japan Standard Time" },
  { value: "Australia/Sydney",     label: "Australia/Sydney — AEST" },
  { value: "Europe/London",        label: "Europe/London — GMT/BST" },
  { value: "Europe/Berlin",        label: "Europe/Berlin — CET/CEST" },
  { value: "Europe/Paris",         label: "Europe/Paris — CET/CEST" },
  { value: "Europe/Madrid",        label: "Europe/Madrid — CET/CEST" },
  { value: "America/New_York",     label: "America/New_York — Eastern Time" },
  { value: "America/Chicago",      label: "America/Chicago — Central Time" },
  { value: "America/Denver",       label: "America/Denver — Mountain Time" },
  { value: "America/Phoenix",      label: "America/Phoenix — MST (no DST)" },
  { value: "America/Los_Angeles",  label: "America/Los_Angeles — Pacific Time" },
  { value: "America/Toronto",      label: "America/Toronto — Eastern Time" },
  { value: "America/Sao_Paulo",    label: "America/Sao_Paulo — Brasília Time" },
  { value: "UTC",                  label: "UTC" },
];

// ── Sales targets ─────────────────────────────────────────────────────────────

export interface SalesTopDeal {
  companyName: string | null;
  amount: number;
  invoiceDate: string | null;
}

export interface SalesTargetSummary {
  periodLabel: string;          // e.g. "April 2026"
  actuals: number;
  target: number;
  pctOfTarget: number;
  prevPeriodLabel: string;      // e.g. "March 2026"
  prevActuals: number;
  prevTarget: number;
  prevPctOfTarget: number;
  pctChange: number;
  topClosed: SalesTopDeal[];
}
