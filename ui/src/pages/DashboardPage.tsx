import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Menu, X, ArrowLeft, Calendar, LogOut, Video, ChevronDown } from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import {
  getFolders,
  getQueue,
  getPotentials,
  getAccounts,
  completeQueueItem,
  getCalendarEvents,
  updatePotential,
} from "@/lib/api";
import NewPotentialModal from "@/components/potentials/NewPotentialModal";
import GlobalSearch from "@/components/layout/GlobalSearch";
import type { CalendarEvent } from "@/lib/api";
import CalendarPanel from "@/components/calendar/CalendarPanel";
import type {
  ViewMode,
  Folder,
  QueueItem,
  PotentialDeal,
  PotentialFilters,
  AccountSummary,
  AccountFilters,
} from "@/types";
import { DEAL_STAGES } from "@/types";
import FolderPanel from "@/components/sidebar/FolderPanel";
import QueuePanel from "@/components/queue/QueuePanel";
import PotentialsList from "@/components/potentials/PotentialsList";
import AccountsList from "@/components/accounts/AccountsList";
import DetailPanel from "@/components/detail/DetailPanel";

function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < breakpoint);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [breakpoint]);
  return isMobile;
}

const STAGE_ORDER = Object.fromEntries(DEAL_STAGES.map((s, i) => [s, i]));

export default function DashboardPage() {
  const isMobile = useIsMobile();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const [calendarOpen, setCalendarOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!userMenuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [userMenuOpen]);

  // ── Next meeting ────────────────────────────────────────────────────────────
  const [nextMeeting, setNextMeeting] = useState<CalendarEvent | null>(null);
  const [, setNow] = useState(() => new Date());

  const refreshNextMeeting = useCallback(async () => {
    try {
      const events = await getCalendarEvents(1);
      const now = new Date();
      const cutoff = new Date(now.getTime() + 8 * 60 * 60 * 1000);
      const next = events
        .filter((e) => e.start && new Date(e.start) > now && new Date(e.start) <= cutoff)
        .sort((a, b) => new Date(a.start!).getTime() - new Date(b.start!).getTime())[0] ?? null;
      setNextMeeting(next);
    } catch {
      // MS not connected or error — silently skip
    }
  }, []);

  useEffect(() => {
    refreshNextMeeting();
    const fetchInterval = setInterval(refreshNextMeeting, 5 * 60 * 1000); // re-fetch every 5 min
    const tickInterval = setInterval(() => setNow(new Date()), 60 * 1000);  // tick every 1 min for countdown
    return () => { clearInterval(fetchInterval); clearInterval(tickInterval); };
  }, [refreshNextMeeting]);

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const sidebarInitialized = useRef(false);
  useEffect(() => {
    if (!sidebarInitialized.current) {
      setSidebarOpen(window.innerWidth >= 768);
      sidebarInitialized.current = true;
    }
  }, []);

  const [mobileShowDetail, setMobileShowDetail] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("queue");

  // Queue state
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [selectedQueueItemId, setSelectedQueueItemId] = useState<string | null>(null);
  const [loadingFolders, setLoadingFolders] = useState(true);
  const [loadingQueue, setLoadingQueue] = useState(false);

  // Potentials state
  const [potentialDeals, setPotentialDeals] = useState<PotentialDeal[]>([]);
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  const [potentialFilters, setPotentialFilters] = useState<PotentialFilters>({
    stages: [],
    services: [],
    owners: [],
    search: "",
    sortBy: "value-desc",
  });
  const [filterOptions, setFilterOptions] = useState<{ owners: string[]; services: string[]; stages: string[] }>({
    owners: [],
    services: [],
    stages: [],
  });
  const [loadingPotentials, setLoadingPotentials] = useState(false);

  // Limit owner filter to the logged-in user only
  const myFilterOptions = {
    ...filterOptions,
    owners: user?.name ? filterOptions.owners.filter((o) => o === user.name) : filterOptions.owners,
  };

  // Accounts state
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [accountFilters, setAccountFilters] = useState<AccountFilters>({
    search: "",
    industries: [],
    sortBy: "name-az",
  });
  const [accountFilterOptions, setAccountFilterOptions] = useState<{ industries: string[] }>({
    industries: [],
  });
  const [loadingAccounts, setLoadingAccounts] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [newPotentialOpen, setNewPotentialOpen] = useState(false);

  // Fetch folders on mount
  useEffect(() => {
    async function load() {
      try {
        setLoadingFolders(true);
        const data = await getFolders();
        const list = data.folders ?? [];
        setFolders(list);
        if (list.length > 0) setSelectedFolderId(list[0].id);
      } catch {
        setError("Failed to load folders");
      } finally {
        setLoadingFolders(false);
      }
    }
    load();
  }, []);

  // Fetch queue items when folder changes
  useEffect(() => {
    if (!selectedFolderId || viewMode !== "queue") return;
    async function load() {
      try {
        setLoadingQueue(true);
        setSelectedQueueItemId(null);
        const data = await getQueue(selectedFolderId!);
        setQueueItems(data.items ?? []);
      } catch {
        setError("Failed to load queue items");
        setQueueItems([]);
      } finally {
        setLoadingQueue(false);
      }
    }
    load();
  }, [selectedFolderId, viewMode]);

  // Fetch potentials
  useEffect(() => {
    if (viewMode !== "potentials") return;
    async function load() {
      try {
        setLoadingPotentials(true);
        const data = await getPotentials(potentialFilters);
        setPotentialDeals(data.deals ?? []);
        setFilterOptions(data.filterOptions ?? { owners: [], services: [], stages: [] });
      } catch {
        setError("Failed to load potentials");
        setPotentialDeals([]);
      } finally {
        setLoadingPotentials(false);
      }
    }
    load();
  }, [viewMode, potentialFilters]);

  // Fetch accounts
  useEffect(() => {
    if (viewMode !== "accounts") return;
    async function load() {
      try {
        setLoadingAccounts(true);
        const data = await getAccounts(accountFilters);
        setAccounts(data.accounts ?? []);
        setAccountFilterOptions(data.filterOptions ?? { industries: [] });
      } catch {
        setAccounts([]);
      } finally {
        setLoadingAccounts(false);
      }
    }
    load();
  }, [viewMode, accountFilters]);

  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    if (mode === "queue") {
      setSelectedDealId(null);
      setSelectedAccountId(null);
    } else if (mode === "potentials") {
      setSelectedQueueItemId(null);
      setSelectedAccountId(null);
    } else {
      setSelectedQueueItemId(null);
      setSelectedDealId(null);
    }
    setMobileShowDetail(false);
  }, []);

  const handleFolderSelect = useCallback((folderId: string) => {
    setSelectedFolderId(folderId);
    if (window.innerWidth < 768) setSidebarOpen(false);
  }, []);

  const handleQueueItemSelect = useCallback((itemId: string) => {
    setSelectedQueueItemId(itemId);
    if (isMobile) setMobileShowDetail(true);
  }, [isMobile]);

  const handleDealSelect = useCallback((dealId: string) => {
    setSelectedDealId(dealId);
    if (isMobile) setMobileShowDetail(true);
  }, [isMobile]);

  const handleAccountSelect = useCallback((accountId: string) => {
    setSelectedAccountId(accountId);
    if (isMobile) setMobileShowDetail(true);
  }, [isMobile]);

  const handleComplete = useCallback(async () => {
    if (!selectedQueueItemId) return;
    try {
      await completeQueueItem(selectedQueueItemId);
    } catch { /* optimistic */ }

    const currentIndex = queueItems.findIndex((item) => item.id === selectedQueueItemId);
    const remaining = queueItems.filter((item) => item.id !== selectedQueueItemId);
    setQueueItems(remaining);

    if (selectedFolderId) {
      setFolders((prev) =>
        prev.map((f) =>
          f.id === selectedFolderId ? { ...f, count: Math.max(0, f.count - 1) } : f
        )
      );
    }

    if (remaining.length > 0) {
      setSelectedQueueItemId(remaining[Math.min(currentIndex, remaining.length - 1)].id);
    } else {
      setSelectedQueueItemId(null);
      if (isMobile) setMobileShowDetail(false);
    }
  }, [selectedQueueItemId, selectedFolderId, queueItems, isMobile]);

  const handleMobileBack = useCallback(() => {
    setMobileShowDetail(false);
    setSelectedQueueItemId(null);
    setSelectedDealId(null);
    setSelectedAccountId(null);
  }, []);

  const activeFilterCount =
    potentialFilters.stages.length +
    potentialFilters.services.length +
    potentialFilters.owners.length +
    (potentialFilters.search ? 1 : 0);

  const handleClearFilters = useCallback(() => {
    setPotentialFilters((prev) => ({
      stages: [],
      services: [],
      owners: [],
      search: "",
      sortBy: prev.sortBy,
    }));
  }, []);

  const [newDealInitialTab, setNewDealInitialTab] = useState<"action" | undefined>(undefined);

  const handlePotentialCreated = useCallback((dealId: string) => {
    setViewMode("potentials");
    setSelectedDealId(dealId);
    setNewDealInitialTab("action");
    if (isMobile) setMobileShowDetail(true);
    setPotentialFilters((prev) => ({ ...prev }));
  }, [isMobile]);

  const handleSearchNavigate = useCallback((payload: { type: string; id?: string; accountId?: string; potentialId?: string }) => {
    if (payload.type === "potential" && payload.id) {
      setViewMode("potentials");
      setSelectedDealId(payload.id);
      setSelectedAccountId(null);
      if (isMobile) setMobileShowDetail(true);
    } else if (payload.type === "account" && payload.id) {
      setViewMode("accounts");
      setSelectedAccountId(payload.id);
      setSelectedDealId(null);
      if (isMobile) setMobileShowDetail(true);
    } else if (payload.type === "contact" && payload.accountId) {
      setViewMode("accounts");
      setSelectedAccountId(payload.accountId);
      setSelectedDealId(null);
      if (isMobile) setMobileShowDetail(true);
    } else if (payload.type === "contact-potential" && payload.potentialId) {
      setViewMode("potentials");
      setSelectedDealId(payload.potentialId);
      setSelectedAccountId(null);
      if (isMobile) setMobileShowDetail(true);
    }
  }, [isMobile]);

  const handleStageChange = useCallback(async (dealId: string, stage: string) => {
    // Optimistically update the list
    setPotentialDeals((prev) =>
      prev.map((d) => (d.id === dealId ? { ...d, stage } : d))
    );
    try {
      await updatePotential(dealId, { stage });
    } catch {
      // Revert on failure by re-fetching
      getPotentials(potentialFilters).then((data) => setPotentialDeals(data.deals ?? [])).catch(() => {});
    }
  }, [potentialFilters]);

  const sortedDeals = useMemo(() => {
    const sorted = [...potentialDeals];
    switch (potentialFilters.sortBy) {
      case "value-desc": return sorted.sort((a, b) => b.value - a.value);
      case "value-asc": return sorted.sort((a, b) => a.value - b.value);
      case "closing-date":
        return sorted.sort((a, b) => {
          if (!a.closingDate && !b.closingDate) return 0;
          if (!a.closingDate) return 1;
          if (!b.closingDate) return -1;
          return new Date(a.closingDate).getTime() - new Date(b.closingDate).getTime();
        });
      case "stage":
        return sorted.sort((a, b) => (STAGE_ORDER[a.stage] ?? 99) - (STAGE_ORDER[b.stage] ?? 99));
      case "company-az":
        return sorted.sort((a, b) => a.company.name.localeCompare(b.company.name));
      default: return sorted;
    }
  }, [potentialDeals, potentialFilters.sortBy]);

  const sortedAccounts = useMemo(() => {
    const sorted = [...accounts];
    switch (accountFilters.sortBy) {
      case "name-az": return sorted.sort((a, b) => a.name.localeCompare(b.name));
      case "name-za": return sorted.sort((a, b) => b.name.localeCompare(a.name));
      case "value-desc": return sorted.sort((a, b) => b.totalValue - a.totalValue);
      case "deals-desc": return sorted.sort((a, b) => b.dealCount - a.dealCount);
      default: return sorted;
    }
  }, [accounts, accountFilters.sortBy]);

  const currentFolderType = selectedFolderId || "";

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-white">
      {/* Top bar */}
      <div className="flex h-12 items-center border-b border-slate-200 bg-slate-50 px-4 flex-shrink-0">
        <div className="flex items-center gap-2 shrink-0">
          {nextMeeting && nextMeeting.start ? (() => {
            const start = new Date(nextMeeting.start!);
            const diffMs = start.getTime() - Date.now();
            const diffMin = Math.round(diffMs / 60000);
            const countdown = diffMin < 60
              ? `in ${diffMin}m`
              : `in ${Math.floor(diffMin / 60)}h ${diffMin % 60}m`;
            const timeStr = start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
            const title = nextMeeting.subject.length > 32
              ? nextMeeting.subject.slice(0, 30) + "…"
              : nextMeeting.subject;
            return (
              <button
                onClick={() => setCalendarOpen(true)}
                className="flex items-center gap-1.5 rounded-md bg-amber-50 border border-amber-200 px-2.5 py-1 text-xs text-amber-800 hover:bg-amber-100 transition-colors max-w-xs"
                title={nextMeeting.subject}
              >
                {nextMeeting.isOnlineMeeting
                  ? <Video className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                  : <Calendar className="h-3.5 w-3.5 shrink-0 text-amber-600" />}
                <span className="font-medium truncate">{title}</span>
                <span className="text-amber-600 shrink-0">{timeStr}</span>
                <span className="bg-amber-200 text-amber-800 rounded px-1 shrink-0 font-medium">{countdown}</span>
              </button>
            );
          })() : (
            <span className="text-xs text-slate-400">No upcoming meetings</span>
          )}
        </div>
        {/* Global search — centered */}
        <div className="flex-1 flex justify-center px-4">
          <GlobalSearch onNavigate={handleSearchNavigate} />
        </div>

        <div className="flex items-center gap-3 shrink-0 ml-auto">
          <button
            onClick={() => setCalendarOpen(true)}
            className="flex items-center gap-1.5 rounded-md bg-blue-50 border border-blue-200 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 hover:border-blue-300 transition-colors"
            title="Open calendar"
          >
            <Calendar className="h-4 w-4" />
            Calendar
          </button>

          {/* User menu */}
          <div className="relative" ref={userMenuRef}>
            <button
              onClick={() => setUserMenuOpen((v) => !v)}
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-100 transition-colors"
            >
              <div className="h-6 w-6 rounded-full bg-blue-600 flex items-center justify-center shrink-0">
                <span className="text-[10px] font-semibold text-white">
                  {user?.name ? user.name[0].toUpperCase() : "?"}
                </span>
              </div>
              <span className="font-medium max-w-[120px] truncate">{user?.name}</span>
              <ChevronDown className="h-3 w-3 text-slate-400" />
            </button>

            {userMenuOpen && (
              <div className="absolute right-0 top-full mt-1 w-48 rounded-lg border border-slate-200 bg-white shadow-lg z-50 overflow-hidden">
                <div className="px-3 py-2.5 border-b border-slate-100">
                  <p className="text-xs font-semibold text-slate-800 truncate">{user?.name}</p>
                  <p className="text-[10px] text-slate-400 truncate">{user?.email}</p>
                </div>
                <button
                  onClick={() => { setUserMenuOpen(false); logout(); window.location.assign("/login"); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-red-600 hover:bg-red-50 transition-colors"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border-b border-red-200 px-4 py-2 text-sm text-red-700 flex-shrink-0">
          {error}
          <button onClick={() => setError(null)} className="ml-2 text-red-500 hover:text-red-700 underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Mobile sidebar overlay */}
      {isMobile && (
        <>
          {sidebarOpen && (
            <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setSidebarOpen(false)} />
          )}
          <div
            className={`fixed top-0 left-0 z-50 h-full w-[75%] max-w-[300px] shadow-xl transition-transform duration-200 ${
              sidebarOpen ? "translate-x-0" : "-translate-x-full"
            }`}
          >
            <FolderPanel
              folders={folders}
              selectedId={selectedFolderId || ""}
              onSelect={handleFolderSelect}
              loading={loadingFolders}
              viewMode={viewMode}
              onViewModeChange={handleViewModeChange}
              potentialCount={sortedDeals.length}
              filters={potentialFilters}
              onFiltersChange={setPotentialFilters}
              filterOptions={myFilterOptions}
            />
          </div>
        </>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar — desktop only */}
        {!isMobile && (
          <div
            className={`flex-shrink-0 border-r border-slate-200 transition-all duration-200 overflow-hidden ${
              sidebarOpen ? "" : "w-0 border-r-0"
            }`}
            style={sidebarOpen ? { width: "15%", minWidth: 220 } : undefined}
          >
            <FolderPanel
              folders={folders}
              selectedId={selectedFolderId || ""}
              onSelect={handleFolderSelect}
              loading={loadingFolders}
              viewMode={viewMode}
              onViewModeChange={handleViewModeChange}
              potentialCount={sortedDeals.length}
              filters={potentialFilters}
              onFiltersChange={setPotentialFilters}
              filterOptions={myFilterOptions}
              accountCount={sortedAccounts.length}
              accountFilters={accountFilters}
              onAccountFiltersChange={setAccountFilters}
              accountFilterOptions={accountFilterOptions}
            />
          </div>
        )}

        {/* Middle panel */}
        <div
          className={`flex-shrink-0 border-r border-slate-200 overflow-hidden transition-all duration-200 ${
            isMobile && mobileShowDetail ? "w-0 border-r-0" : isMobile ? "flex-1" : ""
          }`}
          style={!isMobile ? { width: "25%", minWidth: 280 } : undefined}
        >
          {isMobile && (
            <div className="flex h-11 items-center gap-2 border-b border-slate-200 px-2 flex-shrink-0">
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"
              >
                {sidebarOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
              </button>
              <span className="text-xs font-semibold text-slate-700 truncate">
                {viewMode === "queue"
                  ? folders.find((f) => f.id === selectedFolderId)?.label || "Queue"
                  : viewMode === "accounts"
                  ? "Accounts"
                  : "Potentials"}
              </span>
            </div>
          )}

          {viewMode === "queue" ? (
            <QueuePanel
              items={queueItems}
              selectedItemId={selectedQueueItemId}
              onSelectItem={handleQueueItemSelect}
              folderType={currentFolderType}
              loading={loadingQueue}
            />
          ) : viewMode === "accounts" ? (
            <AccountsList
              accounts={sortedAccounts}
              selectedAccountId={selectedAccountId}
              onSelectAccount={handleAccountSelect}
              loading={loadingAccounts}
            />
          ) : (
            <PotentialsList
              deals={sortedDeals}
              selectedDealId={selectedDealId}
              onSelectDeal={handleDealSelect}
              loading={loadingPotentials}
              activeFilterCount={activeFilterCount}
              onClearFilters={handleClearFilters}
              onNewDeal={() => setNewPotentialOpen(true)}
              availableStages={filterOptions.stages}
              onStageChange={handleStageChange}
            />
          )}
        </div>

        {/* Detail panel */}
        <div
          className={`border-l border-slate-200 overflow-hidden transition-all duration-200 ${
            isMobile && !mobileShowDetail ? "w-0 border-l-0" : "flex-1"
          }`}
        >
          {isMobile && mobileShowDetail && (
            <div className="flex h-11 items-center gap-2 border-b border-slate-200 px-2 flex-shrink-0">
              <button
                onClick={handleMobileBack}
                className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <span className="text-xs font-semibold text-slate-700">Back to list</span>
            </div>
          )}

          <DetailPanel
            queueItemId={viewMode === "queue" ? selectedQueueItemId : null}
            dealId={
              viewMode === "potentials"
                ? selectedDealId
                : viewMode === "queue"
                ? (queueItems.find((i) => i.id === selectedQueueItemId)?.dealId ?? null)
                : null
            }
            accountId={viewMode === "accounts" ? selectedAccountId : null}
            folderType={viewMode === "queue" ? currentFolderType : "all-potentials"}
            onComplete={handleComplete}
            onPotentialNavigate={(dealId) => {
              setViewMode("potentials");
              setSelectedDealId(dealId);
            }}
            availableStages={filterOptions.stages}
            availableServices={filterOptions.services}
            initialTab={newDealInitialTab}
          />
        </div>
      </div>

      <NewPotentialModal
        isOpen={newPotentialOpen}
        onClose={() => setNewPotentialOpen(false)}
        onCreated={handlePotentialCreated}
        availableStages={filterOptions.stages}
        availableServices={filterOptions.services}
      />

      {calendarOpen && (
        <CalendarPanel onClose={() => {
          setCalendarOpen(false);
          // Small delay to allow MS Graph to propagate newly created/edited events
          setTimeout(refreshNextMeeting, 2000);
        }} />
      )}
    </div>
  );
}
