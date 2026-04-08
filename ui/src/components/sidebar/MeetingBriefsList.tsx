/**
 * MeetingBriefsList — middle panel (Panel 2) view for the "Meeting Briefs"
 * folder. Lists upcoming client meetings as cards. Click → opens the brief
 * overlay in the right panel.
 *
 * Mirrors the visual style of QueuePanel for consistency with other queue folders.
 */

import { Briefcase, Building2, CalendarClock, Check, Clock, Loader2, Video, X } from "lucide-react";
import type { MeetingBriefItem } from "@/lib/api";

interface MeetingBriefsListProps {
  items: MeetingBriefItem[];
  loading: boolean;
  selectedMsEventId: string | null;
  onSelect: (item: MeetingBriefItem) => void;
  onResolve?: (msEventId: string, action: "done" | "skip") => void;
}

function ItemActions({
  msEventId,
  onResolve,
}: {
  msEventId: string;
  onResolve: (id: string, action: "done" | "skip") => void;
}) {
  return (
    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
      <button
        onClick={(e) => { e.stopPropagation(); onResolve(msEventId, "done"); }}
        title="Mark done — I attended / acted on this"
        className="rounded-md p-1 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
      >
        <Check className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onResolve(msEventId, "skip"); }}
        title="Skip — I don't need a brief for this"
        className="rounded-md p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function formatTime(iso: string | null): string {
  if (!iso) return "";
  const utc = iso.endsWith("Z") || iso.includes("+") ? iso : iso + "Z";
  try {
    return new Date(utc).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

function formatDateLabel(iso: string | null): string {
  if (!iso) return "";
  const utc = iso.endsWith("Z") || iso.includes("+") ? iso : iso + "Z";
  try {
    const d = new Date(utc);
    const today = new Date();
    const tomorrow = new Date();
    tomorrow.setDate(today.getDate() + 1);
    if (d.toDateString() === today.toDateString()) return "Today";
    if (d.toDateString() === tomorrow.toDateString()) return "Tomorrow";
    return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

function statusPill(status: string) {
  switch (status) {
    case "completed":
      return { label: "ready", classes: "bg-emerald-50 text-emerald-700 border-emerald-200" };
    case "running":
      return { label: "prepping", classes: "bg-blue-50 text-blue-700 border-blue-200" };
    case "pending":
      return { label: "queued", classes: "bg-slate-100 text-slate-600 border-slate-200" };
    case "error":
      return { label: "failed", classes: "bg-red-50 text-red-700 border-red-200" };
    default:
      return { label: status, classes: "bg-slate-100 text-slate-600 border-slate-200" };
  }
}

function formatCurrency(n: number | null): string {
  if (n === null || n === undefined) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n)}`;
}

export default function MeetingBriefsList({
  items,
  loading,
  selectedMsEventId,
  onSelect,
  onResolve,
}: MeetingBriefsListProps) {
  return (
    <div className="flex h-full flex-col bg-white">
      {/* Header */}
      <div className="flex h-14 items-center justify-between border-b border-slate-200 px-4">
        <span className="text-sm font-semibold text-slate-900">
          {items.length === 0 && loading
            ? "Loading…"
            : `${items.length} client ${items.length === 1 ? "meeting" : "meetings"} · next 24h`}
        </span>
        {loading && items.length > 0 && (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
        )}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {loading && items.length === 0 ? (
          <div className="divide-y divide-slate-100">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="p-3">
                <div className="flex items-start gap-3">
                  <div className="h-9 w-9 animate-pulse rounded-full bg-slate-100" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-3/4 animate-pulse rounded bg-slate-100" />
                    <div className="h-3 w-1/2 animate-pulse rounded bg-slate-100" />
                    <div className="h-3 w-full animate-pulse rounded bg-slate-100" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center px-6">
            <CalendarClock className="h-8 w-8 text-slate-300 mb-2" />
            <p className="text-sm text-slate-500">No client meetings in the next 24 hours</p>
            <p className="text-[11px] text-slate-400 mt-1 max-w-xs">
              Meetings with attendees from accounts in your CRM will appear here automatically.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {items.map((item) => {
              const sk = item.skeleton;
              const isSelected = sk.msEventId === selectedMsEventId;
              const pill = statusPill(item.brief.status);
              const time = formatTime(sk.meetingStart);
              const dateLabel = formatDateLabel(sk.meetingStart);

              return (
                <div
                  key={sk.msEventId}
                  onClick={() => onSelect(item)}
                  className={`group cursor-pointer w-full text-left px-4 py-3 transition-colors ${
                    isSelected
                      ? "bg-blue-50 border-l-2 border-blue-500"
                      : "hover:bg-slate-50 border-l-2 border-transparent"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {/* Icon */}
                    <div className="h-9 w-9 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center shrink-0">
                      <Briefcase className="h-4 w-4 text-blue-600" />
                    </div>

                    {/* Body */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className={`text-sm font-semibold truncate ${isSelected ? "text-blue-700" : "text-slate-800"}`}>
                          {sk.meetingTitle || sk.potential.name || "Meeting"}
                        </p>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {onResolve && <ItemActions msEventId={sk.msEventId} onResolve={onResolve} />}
                          <span className={`text-[10px] font-semibold rounded-full border px-1.5 py-0.5 ${pill.classes}`}>
                            {pill.label}
                          </span>
                        </div>
                      </div>

                      {/* Meta line 1 — time / date / online */}
                      <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-500">
                        <Clock className="h-3 w-3" />
                        <span>{dateLabel} · {time}</span>
                        {sk.isOnline && (
                          <>
                            <span className="text-slate-300">·</span>
                            <Video className="h-3 w-3" />
                            <span>Online</span>
                          </>
                        )}
                      </div>

                      {/* Meta line 2 — account / contact */}
                      {(sk.account?.name || sk.contact?.name) && (
                        <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-500">
                          <Building2 className="h-3 w-3" />
                          <span className="truncate">
                            {sk.account?.name || "—"}
                            {sk.contact?.name && <span className="text-slate-400"> · {sk.contact.name}</span>}
                          </span>
                        </div>
                      )}

                      {/* Meta line 3 — deal facts */}
                      <div className="mt-1 flex items-center gap-2 text-[10px]">
                        {sk.potential.potentialNumber && (
                          <span className="font-mono text-slate-500">#{sk.potential.potentialNumber}</span>
                        )}
                        {sk.potential.stage && (
                          <span className="rounded bg-slate-100 text-slate-600 px-1.5 py-0.5">{sk.potential.stage}</span>
                        )}
                        {sk.potential.amount !== null && (
                          <span className="text-slate-600 font-semibold">{formatCurrency(sk.potential.amount)}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
