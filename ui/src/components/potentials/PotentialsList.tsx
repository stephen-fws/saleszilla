import { useState, useRef, useEffect } from "react";
import { Briefcase, Building2, X, Plus, ChevronDown, Loader2, Users } from "lucide-react";
import type { PotentialDeal } from "@/types";
import { groupByDateBucket } from "@/lib/utils";

const STAGE_COLORS: Record<string, string> = {
  // Real DB stage names
  Prospects: "bg-slate-100 text-slate-600",
  "Pre Qualified": "bg-blue-100 text-blue-700",
  "Requirements Capture": "bg-indigo-100 text-indigo-700",
  Proposal: "bg-amber-100 text-amber-700",
  Contracting: "bg-orange-100 text-orange-700",
  Closed: "bg-emerald-100 text-emerald-700",
  "Contact Later": "bg-slate-100 text-slate-500",
  Sleeping: "bg-slate-100 text-slate-500",
  "Low Value": "bg-slate-100 text-slate-500",
  Disqualified: "bg-red-100 text-red-600",
  Lost: "bg-red-100 text-red-700",
  // Normalized fallbacks
  prospect: "bg-slate-100 text-slate-600",
  qualification: "bg-blue-100 text-blue-700",
  proposal: "bg-amber-100 text-amber-700",
  negotiation: "bg-purple-100 text-purple-700",
  "closed-won": "bg-emerald-100 text-emerald-700",
  "closed-lost": "bg-red-100 text-red-700",
};

function StageSelector({
  stage,
  availableStages,
  onStageChange,
}: {
  stage: string;
  availableStages: string[];
  onStageChange: (stage: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setPending(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  function handleSelect(newStage: string) {
    if (newStage === stage) { setOpen(false); return; }
    setPending(newStage);
  }

  async function confirm() {
    if (!pending) return;
    setSaving(true);
    setOpen(false);
    try { await onStageChange(pending); } finally { setSaving(false); setPending(null); }
  }

  function cancel() {
    setPending(null);
  }

  const colorClass = STAGE_COLORS[stage] ?? "bg-slate-100 text-slate-600";

  return (
    <div ref={ref} className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); setPending(null); }}
        className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium transition-opacity hover:opacity-75 ${colorClass}`}
      >
        {saving ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : stage}
        {!saving && <ChevronDown className="h-2.5 w-2.5 opacity-60" />}
      </button>

      {open && availableStages.length > 0 && (
        <div className="absolute left-0 top-full mt-1 z-30 min-w-[170px] rounded-lg border border-slate-200 bg-white shadow-lg py-1">
          {pending ? (
            <div className="px-3 py-2 space-y-2">
              <p className="text-[11px] text-slate-600">
                Change stage to{" "}
                <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 font-medium ${STAGE_COLORS[pending] ?? "bg-slate-100 text-slate-600"}`}>
                  {pending}
                </span>
                ?
              </p>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={confirm}
                  className="flex-1 rounded-md bg-blue-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-blue-700 transition-colors"
                >
                  Confirm
                </button>
                <button
                  type="button"
                  onClick={cancel}
                  className="flex-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            availableStages.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => handleSelect(s)}
                className={`w-full text-left px-3 py-1.5 text-xs transition-colors flex items-center gap-2 ${
                  s === stage ? "bg-blue-50 text-blue-700 font-medium" : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                <span className={`inline-block w-2 h-2 rounded-full ${STAGE_COLORS[s]?.split(" ")[0] ?? "bg-slate-300"}`} />
                {s}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function formatValue(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value}`;
}

interface PotentialsListProps {
  deals: PotentialDeal[];
  selectedDealId: string | null;
  onSelectDeal: (dealId: string) => void;
  loading: boolean;
  activeFilterCount?: number;
  onClearFilters?: () => void;
  onNewDeal?: () => void;
  availableStages?: string[];
  onStageChange?: (dealId: string, stage: string) => Promise<void>;
  currentUserName?: string | null;
}

export default function PotentialsList({
  deals,
  selectedDealId,
  onSelectDeal,
  loading,
  activeFilterCount = 0,
  onClearFilters,
  onNewDeal,
  availableStages = [],
  onStageChange,
  currentUserName,
}: PotentialsListProps) {
  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex h-14 items-center justify-between border-b border-slate-200 px-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-900">
            {deals.length} {deals.length === 1 ? "potential" : "potentials"}
          </span>
          {activeFilterCount > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">
              {activeFilterCount} {activeFilterCount === 1 ? "filter" : "filters"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {activeFilterCount > 0 && onClearFilters && (
            <button
              onClick={onClearFilters}
              className="flex items-center gap-0.5 text-[10px] text-blue-600 hover:text-blue-800"
            >
              <X className="h-3 w-3" />
              Clear
            </button>
          )}
          {onNewDeal && (
            <button
              onClick={onNewDeal}
              className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-blue-700 transition-colors shadow-sm"
            >
              <Plus className="h-3 w-3" />
              New Potential
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {loading ? (
          <div className="divide-y divide-slate-100">
            {Array.from({ length: 5 }).map((_, i) => (
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
        ) : deals.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Building2 className="h-8 w-8 text-slate-300 mb-2" />
            <p className="text-sm text-slate-500">
              {activeFilterCount > 0 ? "No potentials match your filters" : "No potentials in pipeline"}
            </p>
          </div>
        ) : (
          <div>
            {groupByDateBucket(deals, (d) => d.createdAt).map((group) => (
              <div key={group.label}>
                <div className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur-sm px-3 py-1.5 border-b border-slate-200 text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
                  {group.label}
                </div>
                <div className="divide-y divide-slate-100">
                  {group.items.map((deal) => {
              const isSelected = deal.id === selectedDealId;
              return (
                <button
                  key={deal.id}
                  onClick={() => onSelectDeal(deal.id)}
                  className={`w-full p-3 text-left transition-colors ${
                    isSelected
                      ? "bg-blue-50 border-l-2 border-l-blue-500"
                      : "hover:bg-slate-50 border-l-2 border-l-transparent"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ${
                        isSelected ? "bg-blue-100 text-blue-600" : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      <Briefcase className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-sm font-medium truncate ${isSelected ? "text-blue-900" : "text-slate-900"}`}>
                          {deal.title || deal.company.name}
                        </span>
                        <span className="flex-shrink-0 text-xs font-semibold text-emerald-600">
                          {formatValue(deal.value)}
                        </span>
                      </div>
                      <span className="text-xs text-slate-500 truncate block mt-0.5">
                        {deal.company.name}
                      </span>
                      <span className="text-xs text-slate-400 truncate block">
                        {deal.contact.name}{deal.contact.title ? ` · ${deal.contact.title}` : ""}
                      </span>
                      {/* Reportee badge — shown when the deal belongs to a team member, not the logged-in user */}
                      {currentUserName && deal.ownerName && deal.ownerName !== currentUserName && (
                        <span className="inline-flex items-center gap-1 mt-1 rounded-full bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600">
                          <Users className="h-2.5 w-2.5" />
                          {deal.ownerName}
                        </span>
                      )}
                      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                        <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${STAGE_COLORS[deal.stage] ?? "bg-slate-100 text-slate-600"}`}>
                          {deal.stage}
                        </span>
                        {deal.category === "Diamond" && (
                          <span title="Diamond" className="text-base leading-none">💎</span>
                        )}
                        {deal.category === "Platinum" && (
                          <span title="Platinum" className="text-base leading-none">🏆</span>
                        )}
                        {deal.service && (
                          <span className="text-[10px] text-slate-400 truncate">{deal.service}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
