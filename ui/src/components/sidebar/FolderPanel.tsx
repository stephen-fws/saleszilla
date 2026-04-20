import { useEffect, useRef } from "react";
import {
  Inbox,
  Reply,
  RefreshCw,
  Clock,
  Newspaper,
  TrendingUp,
  Send,
  CalendarCheck,
  LayoutList,
  Briefcase,
  Building2,
  Search,
  X,
  SlidersHorizontal,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import type {
  ViewMode,
  Folder,
  PotentialFilters,
  AccountFilters,
} from "@/types";
import { SORT_OPTIONS, ACCOUNT_SORT_OPTIONS, FILTER_STAGES, FILTER_SERVICES } from "@/types";
import TargetWidget from "./TargetWidget";

interface FolderPanelProps {
  folders: Folder[];
  selectedId: string;
  onSelect: (id: string) => void;
  loading?: boolean;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  potentialCount?: number;
  filters?: PotentialFilters;
  onFiltersChange?: (filters: PotentialFilters) => void;
  filterOptions?: { owners: string[]; services: string[]; stages: string[] };
  accountCount?: number;
  accountFilters?: AccountFilters;
  onAccountFiltersChange?: (filters: AccountFilters) => void;
  accountFilterOptions?: { industries: string[] };
  // Optional: badge override for the meeting-briefs folder so we can show
  // the live count from the new lazy-load flow + a refresh spinner.
  meetingBriefsCount?: number;
  meetingBriefsLoading?: boolean;
  // Team toggle for potentials view
  includeTeam?: boolean;
  onIncludeTeamChange?: (v: boolean) => void;
  // Current user name — used to make their owner filter entry non-uncheckable
  currentUserName?: string | null;
  // Master lists from DB (via lookups endpoint)
  masterStages?: string[];
  masterServices?: string[];
}

const ICON_MAP: Record<string, LucideIcon> = {
  calendarCheck: CalendarCheck,
  inbox: Inbox,
  reply: Reply,
  refreshCw: RefreshCw,
  clock: Clock,
  newspaper: Newspaper,
  trendingUp: TrendingUp,
  send: Send,
};


export default function FolderPanel({
  folders,
  selectedId,
  onSelect,
  loading = false,
  viewMode,
  onViewModeChange,
  potentialCount = 0,
  filters,
  onFiltersChange,
  filterOptions,
  accountCount = 0,
  accountFilters,
  onAccountFiltersChange,
  accountFilterOptions,
  meetingBriefsCount,
  meetingBriefsLoading = false,
  includeTeam = false,
  onIncludeTeamChange,
  currentUserName = null,
  masterStages,
  masterServices,
}: FolderPanelProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const totalCount = folders.reduce((sum, f) => sum + f.count, 0);

  useEffect(() => {
    if (listRef.current && selectedId) {
      const selected = listRef.current.querySelector(`[data-folder-id="${selectedId}"]`);
      if (selected) selected.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [selectedId]);

  const hasActiveFilters =
    filters &&
    (filters.stages.length > 0 ||
      filters.services.length > 0 ||
      filters.owners.length > 0 ||
      filters.search.length > 0);

  const activeFilterCount =
    (filters?.stages.length || 0) +
    (filters?.services.length || 0) +
    (filters?.owners.length || 0) +
    (filters?.search ? 1 : 0);

  function toggleFilter(key: "stages" | "services" | "owners", value: string) {
    if (!filters || !onFiltersChange) return;
    const current = filters[key];
    const updated = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    onFiltersChange({ ...filters, [key]: updated });
  }

  function clearFilters() {
    if (!onFiltersChange) return;
    onFiltersChange({
      stages: [],
      services: [],
      owners: [],
      search: "",
      sortBy: filters?.sortBy || "value-desc",
    });
  }

  const displayCount =
    viewMode === "queue"
      ? totalCount
      : viewMode === "potentials"
      ? potentialCount
      : accountCount;

  return (
    <div className="flex h-full flex-col bg-white">
      {/* Header */}
      <div className="flex h-14 items-center justify-between border-b border-slate-200 px-3">
        <div className="flex items-center gap-1.5">
          <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-emerald-500">
            <span className="text-white text-xs font-bold">SZ</span>
          </div>
          <span className="text-sm font-bold text-slate-900">
            <span className="text-emerald-600">Sale</span>
            <span className="text-amber-500">zilla</span>
          </span>
        </div>
        <span className="text-xs text-slate-400">({displayCount})</span>
      </div>

      {/* View Mode Toggle */}
      <div className="flex border-b border-slate-200">
        {([
          { mode: "queue" as ViewMode, icon: LayoutList, label: "Queue" },
          { mode: "potentials" as ViewMode, icon: Briefcase, label: "Potentials" },
          { mode: "accounts" as ViewMode, icon: Building2, label: "Accounts" },
        ] as const).map(({ mode, icon: Icon, label }) => {
          const isActive = viewMode === mode;
          return (
            <button
              key={mode}
              onClick={() => onViewModeChange(mode)}
              title={label}
              className={`flex-1 flex items-center justify-center py-2.5 transition-colors relative group ${
                isActive
                  ? "text-blue-600 bg-blue-50/50"
                  : "text-slate-400 hover:text-slate-600 hover:bg-slate-50"
              }`}
            >
              <Icon className="h-4 w-4" />
              {isActive && (
                <span className="absolute bottom-0 left-3 right-3 h-0.5 bg-blue-600 rounded-t" />
              )}
              <span className="absolute -bottom-7 left-1/2 -translate-x-1/2 px-2 py-0.5 text-[10px] font-medium text-white bg-slate-800 rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
                {label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Content — scrollable */}
      <div ref={listRef} className="flex-1 overflow-y-auto scrollbar-thin min-h-0">
        {viewMode === "accounts" ? (
          <div className="p-3 space-y-4">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={accountFilters?.search || ""}
                onChange={(e) =>
                  onAccountFiltersChange?.({
                    ...(accountFilters || { search: "", industries: [], sortBy: "name-az" }),
                    search: e.target.value,
                  })
                }
                placeholder="Search accounts..."
                className="w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-8 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:bg-white"
              />
              {accountFilters?.search && (
                <button
                  onClick={() => onAccountFiltersChange?.({ ...accountFilters, search: "" })}
                  className="absolute right-2 top-1/2 -translate-y-1/2"
                >
                  <X className="h-3.5 w-3.5 text-slate-400 hover:text-slate-600" />
                </button>
              )}
            </div>

            {/* Sort */}
            <div>
              <label className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider mb-1.5 block">
                Sort By
              </label>
              <select
                value={accountFilters?.sortBy || "name-az"}
                onChange={(e) =>
                  onAccountFiltersChange?.({
                    ...(accountFilters || { search: "", industries: [], sortBy: "name-az" }),
                    sortBy: e.target.value,
                  })
                }
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:bg-white appearance-none cursor-pointer"
              >
                {ACCOUNT_SORT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            {/* Industry filter */}
            {accountFilterOptions && accountFilterOptions.industries.length > 0 && (
              <div>
                <label className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider mb-1.5 block">
                  Industry
                </label>
                <div className="space-y-0.5">
                  {accountFilterOptions.industries.map((industry) => {
                    const isChecked = accountFilters?.industries.includes(industry) || false;
                    return (
                      <label
                        key={industry}
                        className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-xs cursor-pointer transition-colors ${
                          isChecked ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {
                            if (!accountFilters || !onAccountFiltersChange) return;
                            const updated = isChecked
                              ? accountFilters.industries.filter((i) => i !== industry)
                              : [...accountFilters.industries, industry];
                            onAccountFiltersChange({ ...accountFilters, industries: updated });
                          }}
                          className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-300"
                        />
                        <span className="flex-1 truncate">{industry}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="pt-2 border-t border-slate-100">
              <div className="flex items-center gap-1.5 text-xs text-slate-400">
                <SlidersHorizontal className="h-3 w-3" />
                <span>{accountCount} {accountCount === 1 ? "account" : "accounts"} found</span>
              </div>
            </div>
          </div>
        ) : viewMode === "queue" ? (
          loading ? (
            <div className="space-y-1 p-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-9 animate-pulse rounded-md bg-slate-100" />
              ))}
            </div>
          ) : (
            <nav className="space-y-0.5 p-2">
              {folders.map((folder) => {
                const IconComponent = ICON_MAP[folder.icon] || Inbox;
                const isSelected = folder.id === selectedId;
                const isMeetingBriefs = folder.id === "meeting-briefs";
                // Temporarily disabled folders — revisit post-beta.
                const isDisabled = folder.id === "follow-up-inactive" || folder.id === "news";
                const displayCount = folder.count;
                return (
                  <button
                    key={folder.id}
                    data-folder-id={folder.id}
                    onClick={() => { if (!isDisabled) onSelect(folder.id); }}
                    disabled={isDisabled}
                    title={isDisabled ? "Coming soon" : undefined}
                    className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                      isDisabled
                        ? "text-slate-300 cursor-not-allowed"
                        : isSelected
                        ? "bg-slate-200 text-slate-900 font-medium"
                        : "text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    <IconComponent
                      className={`h-4 w-4 flex-shrink-0 ${
                        isDisabled ? "text-slate-300" : isSelected ? "text-slate-900" : "text-slate-400"
                      }`}
                    />
                    <span className="flex-1 truncate">{folder.label}</span>
                    {isMeetingBriefs && meetingBriefsLoading && (
                      <Loader2 className="h-3 w-3 animate-spin text-blue-500 flex-shrink-0" />
                    )}
                    {!isDisabled && displayCount > 0 && !(isMeetingBriefs && meetingBriefsLoading) && (
                      <span
                        className={`flex-shrink-0 rounded-full px-1.5 py-0.5 text-xs font-medium ${
                          isSelected ? "bg-slate-300 text-slate-800" : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {displayCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          )
        ) : (
          // Potentials filter sidebar
          <div className="p-3 space-y-4">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={filters?.search || ""}
                onChange={(e) =>
                  onFiltersChange?.({
                    ...(filters || { stages: [], services: [], owners: [], search: "", sortBy: "value-desc" }),
                    search: e.target.value,
                  })
                }
                placeholder="Search potentials..."
                className="w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-8 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:bg-white"
              />
              {filters?.search && (
                <button
                  onClick={() => onFiltersChange?.({ ...filters, search: "" })}
                  className="absolute right-2 top-1/2 -translate-y-1/2"
                >
                  <X className="h-3.5 w-3.5 text-slate-400 hover:text-slate-600" />
                </button>
              )}
            </div>

            {/* Team toggle */}
            {onIncludeTeamChange && (
              <div className="flex items-center justify-between">
                <label className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">
                  Include My Team
                </label>
                <button
                  onClick={() => onIncludeTeamChange(!includeTeam)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    includeTeam ? "bg-blue-600" : "bg-slate-200"
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
                      includeTeam ? "translate-x-[18px]" : "translate-x-[3px]"
                    }`}
                  />
                </button>
              </div>
            )}

            {/* Sort */}
            <div>
              <label className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider mb-1.5 block">
                Sort By
              </label>
              <select
                value={filters?.sortBy || "value-desc"}
                onChange={(e) =>
                  onFiltersChange?.({
                    ...(filters || { stages: [], services: [], owners: [], search: "", sortBy: "value-desc" }),
                    sortBy: e.target.value,
                  })
                }
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:bg-white appearance-none cursor-pointer"
              >
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            {/* Stage filter */}
            <div>
              <label className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider mb-1.5 block">
                Stage
              </label>
              <div className="space-y-0.5">
                {(masterStages?.length ? masterStages : FILTER_STAGES as unknown as string[]).map((stage) => {
                  const isChecked = filters?.stages.includes(stage) || false;
                  return (
                    <label
                      key={stage}
                      className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-xs cursor-pointer transition-colors ${
                        isChecked ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleFilter("stages", stage)}
                        className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-300"
                      />
                      <span className="flex-1">{stage}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Service filter */}
            <div>
              <label className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider mb-1.5 block">
                Service
              </label>
              <div className="space-y-0.5">
                {(masterServices?.length ? masterServices : FILTER_SERVICES as unknown as string[]).map((service) => {
                  const isChecked = filters?.services.includes(service) || false;
                  return (
                    <label
                      key={service}
                      className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-xs cursor-pointer transition-colors ${
                        isChecked ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleFilter("services", service)}
                        className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-300"
                      />
                      <span className="flex-1 truncate">{service}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Owner filter */}
            {filterOptions && filterOptions.owners.length > 0 && (
              <div>
                <label className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider mb-1.5 block">
                  Owner
                </label>
                <div className="space-y-0.5">
                  {filterOptions.owners.map((owner) => {
                    const isMe = currentUserName != null && owner === currentUserName;
                    // When team toggle is OFF: only "You" row shows, always checked, non-checkable
                    // When team toggle is ON: all owners are freely checkable
                    const locked = !includeTeam && isMe;
                    const isChecked = locked || (filters?.owners.includes(owner) || false);
                    return (
                      <label
                        key={owner}
                        className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors ${
                          locked
                            ? "bg-blue-50 text-blue-700 cursor-default"
                            : isChecked
                              ? "bg-blue-50 text-blue-700 cursor-pointer"
                              : "text-slate-600 hover:bg-slate-50 cursor-pointer"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          disabled={locked}
                          onChange={() => { if (!locked) toggleFilter("owners", owner); }}
                          className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-300 disabled:opacity-60"
                        />
                        <span className="flex-1 truncate">{owner}</span>
                        {isMe && (
                          <span className="text-[9px] text-blue-400 font-medium shrink-0">You</span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="pt-2 border-t border-slate-100">
              {hasActiveFilters && (
                <button
                  onClick={clearFilters}
                  className="flex items-center gap-1 text-[11px] font-medium text-blue-600 hover:text-blue-800 mb-2"
                >
                  <X className="h-3 w-3" />
                  Clear filters
                  <span className="rounded-full bg-blue-100 px-1.5 text-[10px]">{activeFilterCount}</span>
                </button>
              )}
              <div className="flex items-center gap-1.5 text-xs text-slate-400">
                <SlidersHorizontal className="h-3 w-3" />
                <span>{potentialCount} {potentialCount === 1 ? "potential" : "potentials"} found</span>
              </div>
            </div>
          </div>
        )}
      </div>
      {/* Target widget — always pinned at bottom */}
      <TargetWidget />
    </div>
  );
}
