import { useEffect, useMemo, useState } from "react";
import {
  Loader2, Star, ArrowRightLeft, Pencil, StickyNote, CheckSquare,
  Paperclip, Mail, Trash2, Clock, Phone, Bot,
} from "lucide-react";
import { getActivities } from "@/lib/api";
import type { ActivityEntry } from "@/lib/api";

// activity_types written by the AI workflow tracker (server-side
// log_agent_trigger). Used to drive the "AI events" filter toggle.
const AI_ACTIVITY_TYPES = new Set(["agent_triggered"]);

// ── Activity type config ───────────────────────────────────────────────────────

interface ActivityConfig {
  icon: typeof Loader2;
  iconBg: string;
  iconColor: string;
  label: string;
}

const ACTIVITY_CONFIG: Record<string, ActivityConfig> = {
  potential_created: { icon: Star,           iconBg: "bg-blue-100",    iconColor: "text-blue-600",   label: "Created" },
  stage_changed:     { icon: ArrowRightLeft, iconBg: "bg-purple-100",  iconColor: "text-purple-600", label: "Stage Changed" },
  field_updated:     { icon: Pencil,         iconBg: "bg-slate-100",   iconColor: "text-slate-500",  label: "Field Updated" },
  note_added:        { icon: StickyNote,     iconBg: "bg-amber-100",   iconColor: "text-amber-600",  label: "Note Added" },
  note_edited:       { icon: StickyNote,     iconBg: "bg-amber-100",   iconColor: "text-amber-500",  label: "Note Edited" },
  note_deleted:      { icon: Trash2,         iconBg: "bg-red-100",     iconColor: "text-red-500",    label: "Note Deleted" },
  todo_created:      { icon: CheckSquare,    iconBg: "bg-emerald-100", iconColor: "text-emerald-600",label: "Todo Created" },
  todo_updated:      { icon: CheckSquare,    iconBg: "bg-emerald-100", iconColor: "text-emerald-500",label: "Todo Updated" },
  todo_deleted:      { icon: Trash2,         iconBg: "bg-red-100",     iconColor: "text-red-500",    label: "Todo Deleted" },
  file_uploaded:     { icon: Paperclip,      iconBg: "bg-indigo-100",  iconColor: "text-indigo-600", label: "File Uploaded" },
  file_deleted:      { icon: Trash2,         iconBg: "bg-red-100",     iconColor: "text-red-500",    label: "File Deleted" },
  email_sent:        { icon: Mail,           iconBg: "bg-sky-100",     iconColor: "text-sky-600",    label: "Email Sent" },
  call_logged:       { icon: Phone,          iconBg: "bg-green-100",   iconColor: "text-green-600",  label: "Call" },
  agent_triggered:   { icon: Bot,            iconBg: "bg-violet-100",  iconColor: "text-violet-600", label: "AI Workflow" },
};

const DEFAULT_CONFIG: ActivityConfig = {
  icon: Clock,
  iconBg: "bg-slate-100",
  iconColor: "text-slate-400",
  label: "Activity",
};

// ── Time formatting ────────────────────────────────────────────────────────────

function formatTimeAgo(isoString: string | null): string {
  if (!isoString) return "";
  const date = new Date(isoString.endsWith("Z") || isoString.includes("+") ? isoString : isoString + "Z");
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: diffD > 365 ? "numeric" : undefined });
}

function formatFullDate(isoString: string | null): string {
  if (!isoString) return "";
  const date = new Date(isoString.endsWith("Z") || isoString.includes("+") ? isoString : isoString + "Z");
  return date.toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function TimelineTab({ dealId, refreshKey }: { dealId: string; refreshKey?: number }) {
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAiEvents, setShowAiEvents] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getActivities(dealId)
      .then((data) => { if (!cancelled) setActivities(data); })
      .catch(() => { if (!cancelled) setError("Failed to load timeline"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [dealId, refreshKey]);

  const aiEventCount = useMemo(
    () => activities.filter((a) => AI_ACTIVITY_TYPES.has(a.activityType)).length,
    [activities],
  );
  const visibleActivities = useMemo(
    () => (showAiEvents ? activities : activities.filter((a) => !AI_ACTIVITY_TYPES.has(a.activityType))),
    [activities, showAiEvents],
  );

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <p className="text-sm text-red-500">{error}</p>
      </div>
    );
  }

  if (activities.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mb-3">
          <Clock className="h-5 w-5 text-slate-400" />
        </div>
        <p className="text-sm font-medium text-slate-500">No activity yet</p>
        <p className="text-xs text-slate-400 mt-1">Actions on this potential will appear here</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-3">
      {aiEventCount > 0 && (
        <div className="flex items-center justify-end gap-2 pb-2 -mt-1">
          <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showAiEvents}
              onChange={(e) => setShowAiEvents(e.target.checked)}
              className="h-3 w-3 rounded border-slate-300 text-violet-600 focus:ring-violet-300"
            />
            <Sparkles className="h-3 w-3 text-violet-500" />
            <span>Show AI events ({aiEventCount})</span>
          </label>
        </div>
      )}
      <div className="relative">
        {/* Vertical connector line */}
        <div className="absolute left-[15px] top-0 bottom-0 w-px bg-slate-100" />

        <div className="space-y-0">
          {visibleActivities.map((activity, idx) => {
            const cfg = ACTIVITY_CONFIG[activity.activityType] ?? DEFAULT_CONFIG;
            const Icon = cfg.icon;
            const isLast = idx === visibleActivities.length - 1;

            return (
              <div key={activity.id} className={`relative flex gap-3 ${isLast ? "pb-2" : "pb-3"}`}>
                {/* Icon dot */}
                <div className={`relative z-10 flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-full ${cfg.iconBg}`}>
                  <Icon className={`h-3.5 w-3.5 ${cfg.iconColor}`} />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0 pt-1">
                  {(() => {
                    // For field_updated, extract "Field Name: old → new" so the
                    // field name is shown as the title and the diff as body.
                    let title = cfg.label;
                    let body = activity.description;
                    if (
                      (activity.activityType === "field_updated" ||
                        activity.activityType === "stage_changed") &&
                      activity.description
                    ) {
                      const colonIdx = activity.description.indexOf(": ");
                      if (colonIdx !== -1) {
                        title = activity.description.slice(0, colonIdx);
                        body = activity.description.slice(colonIdx + 2);
                      }
                    }
                    return (
                      <>
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-xs font-semibold text-slate-700 leading-tight">{title}</span>
                          <span
                            className="text-[10px] text-slate-400 shrink-0 leading-tight cursor-default"
                            title={formatFullDate(activity.createdTime)}
                          >
                            {formatTimeAgo(activity.createdTime)}
                          </span>
                        </div>
                        {body && (
                          <p className="mt-0.5 text-xs text-slate-500 leading-relaxed break-words whitespace-pre-wrap">
                            {body}
                          </p>
                        )}
                      </>
                    );
                  })()}

                  {activity.performedByName && (
                    <p className="mt-0.5 text-[10px] text-slate-400">{activity.performedByName}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
