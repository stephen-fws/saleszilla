export interface User {
  id: string;
  email: string;
  name: string;
  role: string | null;
  is_active: boolean;
  is_ms_connected: boolean;
  ms_email: string | null;
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
  createdAt: string;
}

export interface PotentialDeal {
  id: string;
  title: string;
  value: number;
  stage: string;
  probability: number;
  service: string | null;
  ownerName: string | null;
  closingDate: string | null;
  category: string | null;
  company: { id: string; name: string; industry: string };
  contact: { id: string; name: string; title: string; email: string };
}

export interface PotentialFilters {
  stages: string[];
  services: string[];
  owners: string[];
  search: string;
  sortBy: string;
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
  billingCity: string | null;
  billingState: string | null;
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
  createdTime: string | null;
  updatedTime: string | null;
}

export interface EmailAttachment {
  name: string;
  contentType: string;
  contentBytes: string; // base64
  sizeBytes: number;    // for display only
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
  closingDate: string | null;
  leadSource: string | null;
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
