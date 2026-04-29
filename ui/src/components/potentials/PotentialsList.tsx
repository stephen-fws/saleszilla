import { Briefcase, Building2, X, Plus, Users } from "lucide-react";
import type { PotentialDeal } from "@/types";
import { groupByDateBucket } from "@/lib/utils";

const STAGE_BADGE = "bg-slate-100 text-slate-700";


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
  onStageChange?: (dealId: string, stage: string, reason?: string) => Promise<void>;
  currentUserName?: string | null;
  // Pagination — total is the server-side count across all pages.
  page?: number;
  pageSize?: number;
  total?: number;
  onPageChange?: (page: number) => void;
}

export default function PotentialsList({
  deals,
  selectedDealId,
  onSelectDeal,
  loading,
  activeFilterCount = 0,
  onClearFilters,
  onNewDeal,
  // availableStages and onStageChange are accepted for API compatibility
  // (DashboardPage passes them) — the actual stage change UI lives in DetailsTab.
  availableStages: _availableStages,
  onStageChange: _onStageChange,
  currentUserName,
  page = 1,
  pageSize = 50,
  total = 0,
  onPageChange,
}: PotentialsListProps) {
  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex h-14 items-center justify-between border-b border-slate-200 px-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-900">
            {total > 0
              ? `${total.toLocaleString()} ${total === 1 ? "potential" : "potentials"}`
              : `${deals.length} ${deals.length === 1 ? "potential" : "potentials"}`}
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
                  onClick={() => {
                    // If the user is actively selecting text inside the card
                    // (drag-select to copy a potential number / company name),
                    // skip navigation so the selection isn't lost on mouseup.
                    if (window.getSelection()?.toString()) return;
                    onSelectDeal(deal.id);
                  }}
                  className={`w-full p-3 text-left transition-colors select-text ${
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
                        <span className={`text-xs font-medium truncate ${isSelected ? "text-blue-900" : "text-slate-900"}`}>
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
                        <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${STAGE_BADGE}`}>
                          {deal.stage}
                        </span>
                        {deal.potentialNumber && (
                          <span className="font-mono text-[10px] text-slate-500" title="Potential number">
                            #{deal.potentialNumber}
                          </span>
                        )}
                        {deal.category === "Diamond" && (
                          <span title="Diamond" className="text-base leading-none">💎</span>
                        )}
                        {deal.category === "Platinum" && (
                          <span title="Platinum" className="text-base leading-none">🔥</span>
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
      {total > pageSize && onPageChange && (
        <Pager page={page} pageSize={pageSize} total={total} onPageChange={onPageChange} />
      )}
    </div>
  );
}

// ── Pager ───────────────────────────────────────────────────────────────────
// Simple Prev / "X–Y of N" / Next footer. Designed for narrow Panel 2 width
// — no page-number buttons (they wrap awkwardly), just direct nav.
function Pager({
  page, pageSize, total, onPageChange,
}: {
  page: number; pageSize: number; total: number; onPageChange: (p: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const from = (safePage - 1) * pageSize + 1;
  const to = Math.min(safePage * pageSize, total);
  const canPrev = safePage > 1;
  const canNext = safePage < totalPages;
  return (
    <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600 shrink-0">
      <span>
        Showing <span className="font-medium text-slate-800">{from.toLocaleString()}–{to.toLocaleString()}</span> of <span className="font-medium text-slate-800">{total.toLocaleString()}</span>
      </span>
      <div className="flex items-center gap-1">
        <button
          onClick={() => canPrev && onPageChange(safePage - 1)}
          disabled={!canPrev}
          className="rounded border border-slate-200 bg-white px-2 py-1 text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Prev
        </button>
        <span className="px-1 text-slate-500">
          {safePage}/{totalPages}
        </span>
        <button
          onClick={() => canNext && onPageChange(safePage + 1)}
          disabled={!canNext}
          className="rounded border border-slate-200 bg-white px-2 py-1 text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Next
        </button>
      </div>
    </div>
  );
}
