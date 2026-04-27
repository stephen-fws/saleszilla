import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Menu, X, ArrowLeft, Calendar, LogOut, Video, ChevronDown, ChevronLeft, ChevronRight, Sparkles, Settings } from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import {
  getFolders,
  getQueue,
  getPotentials,
  getAccounts,
  completeQueueItem,
  skipQueueItem,
  getCalendarEvents,
  updatePotential,
  getUpcomingMeetingBriefs,
  resolveMeetingBrief,
  getLookups,
} from "@/lib/api";
import type { LookupData, UpdatePotentialPayload } from "@/lib/api";
import { reasonFieldForStage } from "@/lib/utils";
import NewPotentialModal from "@/components/potentials/NewPotentialModal";
import GlobalSearch from "@/components/layout/GlobalSearch";
import type { CalendarEvent, MeetingBriefItem } from "@/lib/api";
import CalendarPanel from "@/components/calendar/CalendarPanel";
import GlobalChatPanel from "@/components/chat/GlobalChatPanel";
import SettingsDrawer from "@/components/settings/SettingsDrawer";
import MeetingBriefOverlay from "@/components/sidebar/MeetingBriefOverlay";
import MeetingBriefsList from "@/components/sidebar/MeetingBriefsList";
import ImpersonationSwitcher from "@/components/admin/ImpersonationSwitcher";
import { useImpersonationStore } from "@/store/impersonationStore";
import { confirmDiscardIfDirty } from "@/lib/composerDirty";
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
  const viewingAs = useImpersonationStore((s) => s.viewingAs);
  const clearViewingAs = useImpersonationStore((s) => s.clearViewingAs);

  const [calendarOpen, setCalendarOpen] = useState(false);
  const [globalChatOpen, setGlobalChatOpen] = useState(false);

  // Meeting briefs (Panel 1 section + right-panel overlay)
  const [meetingBriefs, setMeetingBriefs] = useState<MeetingBriefItem[]>([]);
  const [meetingBriefsLoading, setMeetingBriefsLoading] = useState(false);
  const [, setMeetingBriefsError] = useState<string | null>(null);
  const [activeBrief, setActiveBrief] = useState<MeetingBriefItem | null>(null);
  const meetingBriefsAbortRef = useRef<AbortController | null>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  const [middlePanelOpen, setMiddlePanelOpen] = useState(true);
  const sidebarInitialized = useRef(false);
  useEffect(() => {
    if (!sidebarInitialized.current) {
      setSidebarOpen(window.innerWidth >= 768);
      sidebarInitialized.current = true;
    }
  }, []);

  // ── Meeting Briefs ────────────────────────────────────────────────────────
  // Fetch on mount + on tab focus (visibilitychange). Backend is idempotent —
  // cache hits return instantly, only fires the agent for missing/stale briefs.
  const refreshMeetingBriefs = useCallback(async () => {
    // Cancel any in-flight request to avoid race conditions
    meetingBriefsAbortRef.current?.abort();
    meetingBriefsAbortRef.current = new AbortController();
    setMeetingBriefsLoading(true);
    setMeetingBriefsError(null);
    try {
      const items = await getUpcomingMeetingBriefs(24);
      // Auto-expire: hide meetings whose end time + 1hr has passed
      const now = Date.now();
      const EXPIRY_MS = 60 * 60 * 1000; // 1 hour
      const active = items.filter((item) => {
        const end = item.skeleton.meetingEnd;
        if (!end) return true;
        const endMs = new Date(end.endsWith("Z") ? end : end + "Z").getTime();
        return isNaN(endMs) || now < endMs + EXPIRY_MS;
      });
      setMeetingBriefs(active);
      // If an overlay is open, keep its data fresh by re-binding to the latest version
      setActiveBrief((prev) => {
        if (!prev) return prev;
        const updated = items.find((i) => i.skeleton.msEventId === prev.skeleton.msEventId);
        return updated ?? prev;
      });
    } catch (err) {
      if ((err as Error).name !== "CanceledError" && (err as Error).name !== "AbortError") {
        setMeetingBriefsError("Failed to load meeting briefs");
      }
    } finally {
      setMeetingBriefsLoading(false);
    }
  }, []);

  // Initial fetch on mount
  useEffect(() => {
    refreshMeetingBriefs();
  }, [refreshMeetingBriefs]);


  // Poll every 30s while any brief is pending/running. Stops once all are completed.
  // Tab focus + dashboard mount + calendar close still fire instant refreshes,
  // so this only matters when the user is actively staring at the page.
  useEffect(() => {
    const anyInFlight = meetingBriefs.some((b) => b.brief.status === "pending" || b.brief.status === "running");
    if (!anyInFlight) return;
    const id = setInterval(refreshMeetingBriefs, 30000);
    return () => clearInterval(id);
  }, [meetingBriefs, refreshMeetingBriefs]);

  const [mobileShowDetail, setMobileShowDetail] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("queue");

  // Queue state
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [selectedQueueItemId, setSelectedQueueItemId] = useState<string | null>(null);
  const [loadingFolders, setLoadingFolders] = useState(true);
  // Tracks the lightweight background refresh (after Skip/Done, send-email,
  // tab-focus, etc.) so the sidebar can show a subtle spinner.
  const [refreshingFolders, setRefreshingFolders] = useState(false);
  const [loadingQueue, setLoadingQueue] = useState(false);

  // Potentials state
  const [potentialDeals, setPotentialDeals] = useState<PotentialDeal[]>([]);
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  const [includeTeam, setIncludeTeam] = useState(false);
  const [potentialFilters, setPotentialFilters] = useState<PotentialFilters>({
    stages: [],
    services: [],
    owners: [],
    search: "",
    sortBy: "created-desc",
    createdFrom: null,
    createdTo: null,
  });
  const [filterOptions, setFilterOptions] = useState<{ owners: string[]; services: string[]; stages: string[] }>({
    owners: [],
    services: [],
    stages: [],
  });
  const [loadingPotentials, setLoadingPotentials] = useState(false);

  // When includeTeam is OFF: show only the logged-in user in the owner filter (non-checkable, always included).
  // When includeTeam is ON: show the full owner list returned by the backend (which contains the user + their reports).
  const myFilterOptions = {
    ...filterOptions,
    owners: includeTeam
      ? filterOptions.owners
      : user?.name ? filterOptions.owners.filter((o) => o === user.name) : filterOptions.owners,
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
  const [lookups, setLookups] = useState<LookupData>({ services: [], subServiceMap: {}, stages: [], industries: [] });
  const [newPotentialOpen, setNewPotentialOpen] = useState(false);

  // Auto-close the meeting brief overlay when the user navigates somewhere else.
  // Triggered by changes to selectedDealId, selectedAccountId, selectedQueueItemId, viewMode.
  useEffect(() => {
    if (activeBrief !== null) setActiveBrief(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDealId, selectedAccountId, selectedQueueItemId, viewMode]);

  // Auto-advance: when the selected queue item disappears (after refresh
  // post-send, agent auto-resolve, etc.), pick the next item at the same
  // position. If the queue is empty, clear selection — Panel 3 returns to
  // the "select an item" empty state instead of rendering stale tabs.
  const queueItemsHistoryRef = useRef<QueueItem[]>([]);
  useEffect(() => {
    if (viewMode === "queue" && selectedQueueItemId) {
      const stillExists = queueItems.some((i) => i.id === selectedQueueItemId);
      if (!stillExists) {
        const oldList = queueItemsHistoryRef.current;
        const oldIndex = oldList.findIndex((i) => i.id === selectedQueueItemId);
        if (queueItems.length === 0) {
          setSelectedQueueItemId(null);
          if (isMobile) setMobileShowDetail(false);
        } else {
          const target = oldIndex >= 0 ? Math.min(oldIndex, queueItems.length - 1) : 0;
          setSelectedQueueItemId(queueItems[target].id);
        }
      }
    }
    queueItemsHistoryRef.current = queueItems;
  }, [queueItems, selectedQueueItemId, viewMode, isMobile]);

  // Fetch folders — on mount + refreshable
  const refreshFolders = useCallback(async () => {
    setRefreshingFolders(true);
    try {
      const data = await getFolders();
      const list = data.folders ?? [];
      setFolders(list);
      return list;
    } catch {
      return [];
    } finally {
      setRefreshingFolders(false);
    }
  }, []);

  useEffect(() => {
    async function load() {
      setLoadingFolders(true);
      const [list] = await Promise.all([
        refreshFolders(),
        getLookups().then(setLookups).catch(() => {}),
      ]);
      if (list.length > 0 && !selectedFolderId) setSelectedFolderId(list[0].id);
      setLoadingFolders(false);
    }
    load();
  }, [refreshFolders]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh folders + meeting briefs on tab focus (visibilitychange → visible)
  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState === "visible") {
        refreshMeetingBriefs();
        refreshFolders();
      }
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [refreshMeetingBriefs, refreshFolders]);

  const refreshQueueItems = useCallback(async () => {
    if (!selectedFolderId || viewMode !== "queue") return;
    try {
      const data = await getQueue(selectedFolderId);
      setQueueItems(data.items ?? []);
    } catch { /* ignore */ }
  }, [selectedFolderId, viewMode]);

  const refreshPotentialsList = useCallback(async () => {
    if (viewMode !== "potentials") return;
    try {
      const data = await getPotentials({ ...potentialFilters, includeTeam });
      setPotentialDeals(data.deals ?? []);
      setFilterOptions(data.filterOptions ?? { owners: [], services: [], stages: [] });
    } catch { /* ignore */ }
  }, [viewMode, potentialFilters, includeTeam]);

  // Bumping this triggers DetailPanel to refetch the deal (timeline,
  // agent results, etc.) without forcing a full unmount/remount.
  const [detailRefreshKey, setDetailRefreshKey] = useState(0);

  const refreshAll = useCallback(async () => {
    await Promise.all([
      refreshFolders(),
      refreshQueueItems(),
      refreshPotentialsList(),
    ]);
    setDetailRefreshKey((k) => k + 1);
  }, [refreshFolders, refreshQueueItems, refreshPotentialsList]);

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
        const data = await getPotentials({ ...potentialFilters, includeTeam });
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
  }, [viewMode, potentialFilters, includeTeam]);

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
    if (mode !== viewMode && !confirmDiscardIfDirty()) return;
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
  }, [viewMode]);

  // Each Panel-2/Panel-1 selection swaps Panel 3, which would unmount the
  // EmailComposer. Guard the transition if the composer has unsaved edits.
  const handleFolderSelect = useCallback((folderId: string) => {
    if (folderId !== selectedFolderId && !confirmDiscardIfDirty()) return;
    setSelectedFolderId(folderId);
    if (window.innerWidth < 768) setSidebarOpen(false);
  }, [selectedFolderId]);

  const handleQueueItemSelect = useCallback((itemId: string) => {
    if (itemId !== selectedQueueItemId && !confirmDiscardIfDirty()) return;
    setSelectedQueueItemId(itemId);
    if (isMobile) setMobileShowDetail(true);
  }, [isMobile, selectedQueueItemId]);

  const handleDealSelect = useCallback((dealId: string) => {
    if (dealId !== selectedDealId && !confirmDiscardIfDirty()) return;
    setSelectedDealId(dealId);
    if (isMobile) setMobileShowDetail(true);
  }, [isMobile, selectedDealId]);

  const handleAccountSelect = useCallback((accountId: string) => {
    if (accountId !== selectedAccountId && !confirmDiscardIfDirty()) return;
    setSelectedAccountId(accountId);
    if (isMobile) setMobileShowDetail(true);
  }, [isMobile, selectedAccountId]);

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

  const handleResolveBrief = useCallback(async (msEventId: string, action: "done" | "skip") => {
    // Optimistic remove from list
    setMeetingBriefs((prev) => prev.filter((b) => b.skeleton.msEventId !== msEventId));
    // If this was the open overlay, close it
    if (activeBrief?.skeleton.msEventId === msEventId) {
      setActiveBrief(null);
    }
    try {
      await resolveMeetingBrief(msEventId, action);
    } catch {
      // ignore — optimistic UX
    }
  }, [activeBrief]);

  const handleResolveQueueItem = useCallback(async (itemId: string, action: "done" | "skip") => {
    // Optimistic remove from list + decrement folder count
    setQueueItems((prev) => prev.filter((i) => i.id !== itemId));
    if (selectedFolderId) {
      setFolders((prev) =>
        prev.map((f) =>
          f.id === selectedFolderId ? { ...f, count: Math.max(0, f.count - 1) } : f
        )
      );
    }
    if (selectedQueueItemId === itemId) {
      setSelectedQueueItemId(null);
      if (isMobile) setMobileShowDetail(false);
    }
    try {
      if (action === "done") {
        await completeQueueItem(itemId);
      } else {
        await skipQueueItem(itemId);
      }
    } catch {
      // ignore — optimistic UX
    }
    // Refresh real folder counts from backend (optimistic decrement may drift)
    refreshFolders();
  }, [selectedFolderId, selectedQueueItemId, isMobile, refreshFolders]);

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
    (potentialFilters.search ? 1 : 0) +
    (potentialFilters.createdFrom || potentialFilters.createdTo ? 1 : 0);

  const handleClearFilters = useCallback(() => {
    setPotentialFilters((prev) => ({
      stages: [],
      services: [],
      owners: [],
      search: "",
      sortBy: prev.sortBy,
      createdFrom: null,
      createdTo: null,
    }));
  }, []);

  const [newDealInitialTab, setNewDealInitialTab] = useState<"action" | undefined>(undefined);

  const handlePotentialCreated = useCallback((dealId: string) => {
    setViewMode("potentials");
    setSelectedDealId(dealId);
    setNewDealInitialTab("action");
    if (isMobile) setMobileShowDetail(true);
    setPotentialFilters((prev) => ({ ...prev }));
    // Refresh folder counts — new potential was added to "new-inquiries" queue
    refreshFolders();
  }, [isMobile, refreshFolders]);

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

  const handleStageChange = useCallback(async (dealId: string, stage: string, reason?: string) => {
    // Optimistically update the list
    setPotentialDeals((prev) =>
      prev.map((d) => (d.id === dealId ? { ...d, stage } : d))
    );
    try {
      const payload: UpdatePotentialPayload = { stage };
      const reasonField = reasonFieldForStage(stage);
      if (reasonField && reason) payload[reasonField] = reason;
      await updatePotential(dealId, payload);
    } catch {
      // Revert on failure by re-fetching
      getPotentials({ ...potentialFilters, includeTeam }).then((data) => setPotentialDeals(data.deals ?? [])).catch(() => {});
    }
  }, [potentialFilters, includeTeam]);

  const sortedDeals = useMemo(() => {
    const sorted = [...potentialDeals];
    switch (potentialFilters.sortBy) {
      case "created-desc":
        return sorted.sort((a, b) => {
          if (!a.createdAt && !b.createdAt) return 0;
          if (!a.createdAt) return 1;
          if (!b.createdAt) return -1;
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });
      case "created-asc":
        return sorted.sort((a, b) => {
          if (!a.createdAt && !b.createdAt) return 0;
          if (!a.createdAt) return 1;
          if (!b.createdAt) return -1;
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        });
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
      {/* Impersonation banner — visible whenever a superadmin is "viewing as" */}
      {viewingAs && (
        <div className="flex items-center justify-center gap-3 bg-slate-800 border-b border-slate-900 px-4 py-1.5 text-xs text-white">
          <span>
            Viewing as <strong>{viewingAs.name}</strong> ({viewingAs.email}) — read-only mode.
          </span>
          <button
            onClick={() => {
              clearViewingAs();
              window.location.reload();
            }}
            className="rounded border border-slate-600 bg-slate-700 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-slate-600"
          >
            Exit
          </button>
        </div>
      )}

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
                className="flex items-center gap-1.5 rounded-md bg-blue-50 border border-blue-200 px-2.5 py-1 text-xs text-blue-800 hover:bg-blue-100 transition-colors max-w-xs"
                title={nextMeeting.subject}
              >
                {nextMeeting.isOnlineMeeting
                  ? <Video className="h-3.5 w-3.5 shrink-0 text-blue-600" />
                  : <Calendar className="h-3.5 w-3.5 shrink-0 text-blue-600" />}
                <span className="font-medium truncate">{title}</span>
                <span className="text-blue-600 shrink-0">{timeStr}</span>
                <span className="bg-blue-200 text-blue-800 rounded px-1 shrink-0 font-medium">{countdown}</span>
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
          {user?.is_super_admin && <ImpersonationSwitcher />}
          <button
            onClick={() => setGlobalChatOpen(true)}
            className="flex items-center gap-1.5 rounded-md bg-gradient-to-br from-blue-500 to-blue-600 px-2.5 py-1 text-xs font-semibold text-white hover:from-blue-600 hover:to-blue-700 transition-all shadow-sm"
            title="Ask Salezilla AI"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Ask AI
          </button>
          {!viewingAs && (
            <button
              onClick={() => setCalendarOpen(true)}
              className="flex items-center gap-1.5 rounded-md bg-blue-50 border border-blue-200 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 hover:border-blue-300 transition-colors"
              title="Open calendar"
            >
              <Calendar className="h-4 w-4" />
              Calendar
            </button>
          )}

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
                  onClick={() => { setUserMenuOpen(false); setSettingsOpen(true); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  <Settings className="h-3.5 w-3.5" />
                  Settings
                </button>
                <div className="border-t border-slate-100" />
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
              refreshing={refreshingFolders}
              viewMode={viewMode}
              onViewModeChange={handleViewModeChange}
              potentialCount={sortedDeals.length}
              filters={potentialFilters}
              onFiltersChange={setPotentialFilters}
              filterOptions={myFilterOptions}
              meetingBriefsCount={meetingBriefs.length}
              meetingBriefsLoading={meetingBriefsLoading}
              includeTeam={includeTeam}
              onIncludeTeamChange={setIncludeTeam}
              currentUserName={user?.name ?? null}
              masterStages={lookups.stages}
              masterServices={lookups.services.map((s) => s.name)}
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
              refreshing={refreshingFolders}
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
              meetingBriefsCount={meetingBriefs.length}
              meetingBriefsLoading={meetingBriefsLoading}
              includeTeam={includeTeam}
              onIncludeTeamChange={setIncludeTeam}
              currentUserName={user?.name ?? null}
              masterStages={lookups.stages}
              masterServices={lookups.services.map((s) => s.name)}
            />
          </div>
        )}

        {/* Middle panel */}
        <div
          className={`flex-shrink-0 overflow-hidden transition-all duration-200 ${
            isMobile && mobileShowDetail
              ? "w-0 border-r-0"
              : isMobile
              ? "flex-1 border-r border-slate-200"
              : middlePanelOpen
              ? "border-r border-slate-200"
              : "w-0 border-r-0"
          }`}
          style={!isMobile && middlePanelOpen ? { width: "25%", minWidth: 280 } : undefined}
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
            selectedFolderId === "meeting-briefs-legacy" ? (
              <MeetingBriefsList
                items={meetingBriefs}
                loading={meetingBriefsLoading}
                selectedMsEventId={activeBrief?.skeleton.msEventId ?? null}
                onSelect={(item) => setActiveBrief(item)}
                onResolve={handleResolveBrief}
              />
            ) : (
              <QueuePanel
                items={queueItems}
                selectedItemId={selectedQueueItemId}
                onSelectItem={handleQueueItemSelect}
                folderType={currentFolderType}
                loading={loadingQueue}
                onResolveItem={viewingAs ? undefined : handleResolveQueueItem}
              />
            )
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
              onNewDeal={viewingAs ? undefined : () => setNewPotentialOpen(true)}
              availableStages={filterOptions.stages}
              onStageChange={handleStageChange}
              currentUserName={includeTeam ? (user?.name ?? null) : null}
            />
          )}
        </div>

        {/* Collapse/expand rail — desktop only */}
        {!isMobile && (() => {
          const collapsedLabel =
            viewMode === "queue"
              ? folders.find((f) => f.id === selectedFolderId)?.label || "Queue"
              : viewMode === "accounts"
              ? "Accounts"
              : "Potentials";
          return (
            <button
              type="button"
              onClick={() => setMiddlePanelOpen((v) => !v)}
              title={middlePanelOpen ? "Collapse list panel" : "Expand list panel"}
              className={`shrink-0 flex flex-col items-center justify-center border-r border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors ${
                middlePanelOpen ? "w-4" : "w-7 gap-2"
              }`}
            >
              {middlePanelOpen ? (
                <ChevronLeft className="h-3 w-3" />
              ) : (
                <>
                  <ChevronRight className="h-3 w-3" />
                  <span
                    className="text-[11px] font-semibold uppercase tracking-wider text-slate-600 whitespace-nowrap"
                    style={{ writingMode: "vertical-rl" }}
                  >
                    {collapsedLabel}
                  </span>
                </>
              )}
            </button>
          );
        })()}

        {/* Detail panel */}
        <div
          className={`overflow-hidden transition-all duration-200 ${
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

          {activeBrief ? (
            <MeetingBriefOverlay
              item={activeBrief}
              onClose={() => setActiveBrief(null)}
              onOpenDeal={(potentialId) => {
                setViewMode("potentials");
                setSelectedDealId(potentialId);
                setActiveBrief(null);
              }}
            />
          ) : (
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
              onEmailSent={refreshAll}
              refreshKey={detailRefreshKey}
              onPotentialNavigate={(dealId) => {
                setViewMode("potentials");
                setSelectedDealId(dealId);
              }}
              availableStages={lookups.stages}
              availableServices={lookups.services.map((s) => s.name)}
              initialTab={viewMode === "queue" ? (currentFolderType === "emails-sent" ? "emails" : "action") : newDealInitialTab}
            />
          )}
        </div>
      </div>

      <NewPotentialModal
        isOpen={newPotentialOpen}
        onClose={() => setNewPotentialOpen(false)}
        onCreated={handlePotentialCreated}
        availableStages={lookups.stages}
        availableServices={lookups.services.map((s) => s.name)}
        subServiceMap={lookups.subServiceMap}
        industries={lookups.industries}
      />

      <SettingsDrawer isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {calendarOpen && (
        <CalendarPanel onClose={() => {
          setCalendarOpen(false);
          // Small delay to allow MS Graph to propagate newly created/edited events
          setTimeout(() => {
            refreshNextMeeting();
            // Also re-check meeting briefs — a new in-app meeting might qualify
            refreshMeetingBriefs();
          }, 2000);
        }} />
      )}

      {globalChatOpen && (
        <GlobalChatPanel onClose={() => setGlobalChatOpen(false)} />
      )}
    </div>
  );
}
