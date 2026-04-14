/**
 * Meeting Brief overlay — focused right-panel view for a single meeting.
 *
 * Shows two layers:
 *   Layer A — instant skeleton (always visible) — meeting time, attendees,
 *             linked deal context, rollups
 *   Layer B — agent-generated brief (markdown) when ready, or a status pill
 *             while it's prepping
 */

import { X, ExternalLink, CalendarClock, Briefcase, Building2, User as UserIcon, Clock, FileText, Mail, CheckSquare, Loader2, AlertCircle, Sparkles } from "lucide-react";
import type { MeetingBriefItem } from "@/lib/api";
import MarkdownBlock from "@/components/chat/MarkdownBlock";

interface MeetingBriefOverlayProps {
  item: MeetingBriefItem;
  onClose: () => void;
  onOpenDeal: (potentialId: string) => void;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const utc = iso.endsWith("Z") || iso.includes("+") ? iso : iso + "Z";
  try {
    return new Date(utc).toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatCurrency(n: number | null): string {
  if (n === null || n === undefined) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n)}`;
}

export default function MeetingBriefOverlay({ item, onClose, onOpenDeal }: MeetingBriefOverlayProps) {
  const sk = item.skeleton;
  const brief = item.brief;
  const isReady = brief.status === "completed" && brief.content;
  const isPrepping = brief.status === "pending" || brief.status === "running";

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-slate-50">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-white shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-sm shrink-0">
            <CalendarClock className="h-4 w-4 text-white" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-slate-900 truncate">{sk.meetingTitle || sk.potential.name || "Meeting Brief"}</h2>
            <p className="text-[11px] text-slate-500">{formatDateTime(sk.meetingStart)}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {sk.potential.potentialId && (
            <button
              onClick={() => onOpenDeal(sk.potential.potentialId)}
              className="flex items-center gap-1 text-[11px] font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-md px-2 py-1 transition-colors"
              title="Open the linked potential"
            >
              <ExternalLink className="h-3 w-3" />
              View potential
            </button>
          )}
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="max-w-3xl mx-auto px-5 py-5 space-y-4">

          {/* Layer A — Instant skeleton */}
          <div className="space-y-4">

            {/* Deal facts strip */}
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-2 mb-3">
                <Briefcase className="h-3.5 w-3.5 text-slate-400" />
                <h3 className="text-[11px] uppercase font-semibold text-slate-500 tracking-wider">Potential</h3>
              </div>
              <p className="text-sm font-semibold text-slate-900">{sk.potential.name || "(Unnamed)"}</p>
              <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                <FactRow label="Stage" value={sk.potential.stage || "—"} />
                <FactRow label="Amount" value={formatCurrency(sk.potential.amount)} />
                <FactRow label="Probability" value={sk.potential.probability != null ? `${sk.potential.probability}%` : "—"} />
                <FactRow label="Closing" value={sk.potential.closingDate || "—"} />
                <FactRow label="Owner" value={sk.potential.owner || "—"} />
                <FactRow label="Number" value={sk.potential.potentialNumber ? `#${sk.potential.potentialNumber}` : "—"} />
              </div>
            </div>

            {/* Account + contact strip */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {sk.account && (
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Building2 className="h-3.5 w-3.5 text-slate-400" />
                    <h3 className="text-[11px] uppercase font-semibold text-slate-500 tracking-wider">Account</h3>
                  </div>
                  <p className="text-sm font-semibold text-slate-900">{sk.account.name || "—"}</p>
                  <p className="text-[11px] text-slate-500 mt-1">{sk.account.industry || "—"}</p>
                  {sk.account.website && (
                    <a href={sk.account.website.startsWith("http") ? sk.account.website : `https://${sk.account.website}`} target="_blank" rel="noopener noreferrer" className="text-[11px] text-blue-600 hover:underline break-all mt-1 block">
                      {sk.account.website}
                    </a>
                  )}
                </div>
              )}

              {sk.contact && (
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <UserIcon className="h-3.5 w-3.5 text-slate-400" />
                    <h3 className="text-[11px] uppercase font-semibold text-slate-500 tracking-wider">Contact</h3>
                  </div>
                  <p className="text-sm font-semibold text-slate-900">{sk.contact.name || "—"}</p>
                  <p className="text-[11px] text-slate-500 mt-1">{sk.contact.title || "—"}</p>
                  {sk.contact.email && (
                    <a href={`mailto:${sk.contact.email}`} className="text-[11px] text-blue-600 hover:underline break-all mt-1 block">
                      {sk.contact.email}
                    </a>
                  )}
                </div>
              )}
            </div>

            {/* Attendees + rollups */}
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Mail className="h-3.5 w-3.5 text-slate-400" />
                    <h3 className="text-[11px] uppercase font-semibold text-slate-500 tracking-wider">External attendees</h3>
                  </div>
                  {sk.attendees.length === 0 ? (
                    <p className="text-[11px] text-slate-400">None detected</p>
                  ) : (
                    <ul className="space-y-1">
                      {sk.attendees.map((a) => (
                        <li key={a.email} className="text-[11px] text-slate-700">
                          <span className="font-medium">{a.name || a.email}</span>
                          {a.name && <span className="text-slate-400"> · {a.email}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Clock className="h-3.5 w-3.5 text-slate-400" />
                    <h3 className="text-[11px] uppercase font-semibold text-slate-500 tracking-wider">Recent activity</h3>
                  </div>
                  <ul className="space-y-1 text-[11px] text-slate-700">
                    <li className="flex items-center gap-1.5">
                      <FileText className="h-3 w-3 text-slate-400" />
                      <span><strong>{sk.rollups.notesCount}</strong> note{sk.rollups.notesCount !== 1 ? "s" : ""}</span>
                    </li>
                    <li className="flex items-center gap-1.5">
                      <CheckSquare className="h-3 w-3 text-slate-400" />
                      <span><strong>{sk.rollups.openTodosCount}</strong> open todo{sk.rollups.openTodosCount !== 1 ? "s" : ""}</span>
                    </li>
                    <li className="flex items-center gap-1.5">
                      <Mail className="h-3 w-3 text-slate-400" />
                      <span><strong>{sk.rollups.recentEmails7d}</strong> email{sk.rollups.recentEmails7d !== 1 ? "s" : ""} this week</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          {/* Layer B — Agent brief */}
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="h-3.5 w-3.5 text-blue-600" />
              <h3 className="text-[11px] uppercase font-semibold text-slate-500 tracking-wider">AI Brief</h3>
            </div>

            {isReady ? (
              <MarkdownBlock content={brief.content || ""} />
            ) : isPrepping ? (
              <div className="flex items-center gap-2 text-[12px] text-slate-500 py-3">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
                Preparing your brief — talking points, recent activity summary, suggested questions…
              </div>
            ) : brief.status === "error" ? (
              <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-[11px] text-red-700">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Brief generation failed</p>
                  {brief.errorMessage && <p className="mt-0.5">{brief.errorMessage}</p>}
                </div>
              </div>
            ) : (
              <p className="text-[12px] text-slate-400">No brief yet.</p>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-slate-100 last:border-0 py-1">
      <span className="text-slate-400">{label}</span>
      <span className="text-slate-700 font-medium truncate">{value}</span>
    </div>
  );
}
