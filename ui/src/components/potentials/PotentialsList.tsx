import { Building2, X, Plus } from "lucide-react";
import type { PotentialDeal } from "@/types";

const STAGE_COLORS: Record<string, string> = {
  prospect: "bg-slate-100 text-slate-600",
  qualification: "bg-blue-100 text-blue-700",
  proposal: "bg-amber-100 text-amber-700",
  negotiation: "bg-purple-100 text-purple-700",
  "closed-won": "bg-emerald-100 text-emerald-700",
  "closed-lost": "bg-red-100 text-red-700",
};

function StageBadge({ stage }: { stage: string }) {
  const colorClass = STAGE_COLORS[stage] || "bg-slate-100 text-slate-600";
  const label = stage
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return (
    <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${colorClass}`}>
      {label}
    </span>
  );
}

function formatValue(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
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
}

export default function PotentialsList({
  deals,
  selectedDealId,
  onSelectDeal,
  loading,
  activeFilterCount = 0,
  onClearFilters,
  onNewDeal,
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
          <div className="divide-y divide-slate-100">
            {deals.map((deal) => {
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
                      <Building2 className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-sm font-medium truncate ${isSelected ? "text-blue-900" : "text-slate-900"}`}>
                          {deal.company.name}
                        </span>
                        <span className="flex-shrink-0 text-xs font-semibold text-emerald-600">
                          {formatValue(deal.value)}
                        </span>
                      </div>
                      <span className="text-xs text-slate-500 truncate block mt-0.5">
                        {deal.contact.name} - {deal.contact.title}
                      </span>
                      <div className="flex items-center gap-1.5 mt-1.5">
                        <StageBadge stage={deal.stage} />
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
        )}
      </div>
    </div>
  );
}
