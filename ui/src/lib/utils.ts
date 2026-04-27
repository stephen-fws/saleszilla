import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Stages that require a reason before the user can confirm the change.
 * Maps normalized stage (lowercase, trimmed) → the UpdatePotentialPayload field
 * that holds the reason.
 */
export function reasonFieldForStage(stage: string): "not_an_inquiry_reason" | "disqualify_reason" | null {
  const s = stage.trim().toLowerCase();
  if (s === "not an inquiry") return "not_an_inquiry_reason";
  if (s === "disqualified") return "disqualify_reason";
  return null;
}

/**
 * Curated list of disqualification reasons. The Disqualified stage prompts a
 * dropdown (no free text) so reporting stays consistent across reps.
 */
export const DISQUALIFY_REASONS: readonly string[] = [
  "Adult",
  "Commission Based",
  "Competitor",
  "Decided Not to Outsource",
  "Director Request",
  "Duplicate Inquiry",
  "Incorrect Contact Info",
  "Indian Inquiry",
  "Individual",
  "No Capability",
  "No Response",
  "Pricing Issues",
  "Seeking Information",
  "Small Inquiry",
  "Student Inquiry",
  "Unrealistic Expectation",
  "Unviable Geography",
  "No DB",
];

/**
 * Curated list of "Not an Inquiry" reasons — same dropdown-only treatment as
 * Disqualified for clean reporting.
 */
export const NOT_AN_INQUIRY_REASONS: readonly string[] = [
  "Career Inquiry",
  "Freelance Inquiry",
  "Seeking Information",
  "Spam Email",
  "Form Testing",
  "Link Exchange",
];

/** When a stage's reason should be picked from a fixed list, return it. */
export function reasonOptionsForStage(stage: string): readonly string[] | null {
  const s = stage.trim().toLowerCase();
  if (s === "disqualified") return DISQUALIFY_REASONS;
  if (s === "not an inquiry") return NOT_AN_INQUIRY_REASONS;
  return null;
}

/**
 * Split a multi-recipient string into individual email addresses.
 * Sync-table rows store To/Cc as `;`-separated (Outlook style); some sources
 * use `,`. Trims whitespace, drops empties, dedupes case-insensitively.
 */
export function splitEmailList(value: string | null | undefined): string[] {
  if (!value) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of value.split(/[;,]/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

export function formatCurrency(value: number | null | undefined): string {
  if (value == null) return "$0";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

export function formatDate(date: string | null | undefined): string {
  if (!date) return "";
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Outlook-style date bucket for a given date — "Today", "Yesterday",
 * "This Week", "Last Week", "This Month", "Last Month", or a "MMM YYYY" label.
 */
export function dateBucket(date: string | null | undefined): string {
  if (!date) return "No Date";
  const d = new Date(date);
  if (isNaN(d.getTime())) return "No Date";

  const now = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const today = startOfDay(now);
  const target = startOfDay(d);
  const diffDays = Math.floor((today.getTime() - target.getTime()) / 86400000);

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";

  // This week = Sun-based week containing today
  const dayOfWeek = today.getDay();
  const startOfThisWeek = new Date(today);
  startOfThisWeek.setDate(today.getDate() - dayOfWeek);
  if (target >= startOfThisWeek && diffDays > 1) return "This Week";

  const startOfLastWeek = new Date(startOfThisWeek);
  startOfLastWeek.setDate(startOfThisWeek.getDate() - 7);
  if (target >= startOfLastWeek) return "Last Week";

  const startOfThisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  if (target >= startOfThisMonth) return "This Month";

  const startOfLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  if (target >= startOfLastMonth) return "Last Month";

  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

/**
 * Group items into ordered date buckets preserving the input order within each bucket.
 * Returns an array of { label, items } in the order buckets first appear.
 */
export function groupByDateBucket<T>(items: T[], getDate: (item: T) => string | null | undefined): { label: string; items: T[] }[] {
  const groups: { label: string; items: T[] }[] = [];
  const index: Record<string, number> = {};
  for (const item of items) {
    const label = dateBucket(getDate(item));
    if (index[label] === undefined) {
      index[label] = groups.length;
      groups.push({ label, items: [item] });
    } else {
      groups[index[label]].items.push(item);
    }
  }
  return groups;
}
