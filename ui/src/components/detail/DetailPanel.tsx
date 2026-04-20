import { useState, useEffect, useRef, useCallback } from "react";
import {
  Loader2,
  Building2,
  User,
  CheckCircle2,
  FolderOpen,
  Inbox,
  Bot,
  Phone,
  Headphones,
} from "lucide-react";
import type { DetailTab, PotentialDetail } from "@/types";
import { getPotentialDetail, updatePotential, getAllAgentResults, getAiHighlight } from "@/lib/api";
import type { UpdatePotentialPayload } from "@/lib/api";
import { reasonFieldForStage } from "@/lib/utils";
import TabBar from "./TabBar";
import NotesTab from "./NotesTab";
import TodosTab from "./TodosTab";
import FilesTab from "./FilesTab";
import DetailsTab from "./DetailsTab";
import TimelineTab from "./TimelineTab";
import AgentResultTab from "./AgentResultTab";
import EmailsTab from "./EmailsTab";
import ChatTab from "./ChatTab";
import AccountDetailPanel from "@/components/accounts/AccountDetailPanel";
import CallDialog from "./CallDialog";
import NextActionTab from "./NextActionTab";
import SupportEmailModal from "@/components/support/SupportEmailModal";

interface DetailPanelProps {
  queueItemId: string | null;
  dealId: string | null;
  accountId?: string | null;
  folderType: string;
  onComplete?: () => void;
  onPotentialNavigate?: (dealId: string) => void;
  onEmailSent?: () => void;
  availableStages?: string[];
  availableServices?: string[];
  initialTab?: DetailTab;
}

const STAGE_COLORS: Record<string, string> = {
  prospect: "bg-slate-100 text-slate-600",
  qualification: "bg-blue-100 text-blue-700",
  proposal: "bg-amber-100 text-amber-700",
  negotiation: "bg-orange-100 text-orange-700",
  "closed-won": "bg-emerald-100 text-emerald-700",
  "closed-lost": "bg-red-100 text-red-700",
};

function StubTab({ label, icon: Icon }: { label: string; icon: typeof Loader2 }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
      <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mb-3">
        <Icon className="h-6 w-6 text-slate-400" />
      </div>
      <p className="text-sm font-medium text-slate-600">{label}</p>
      <p className="text-xs text-slate-400 mt-1">Coming soon</p>
    </div>
  );
}

export default function DetailPanel({
  queueItemId,
  dealId,
  accountId,
  folderType,
  onComplete,
  onPotentialNavigate,
  onEmailSent,
  availableStages = [],
  availableServices = [],
  initialTab,
}: DetailPanelProps) {
  const [activeTab, setActiveTab] = useState<DetailTab>(initialTab ?? "details");
  const [detail, setDetail] = useState<PotentialDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agentsRunning, setAgentsRunning] = useState(false);
  const [aiHighlight, setAiHighlight] = useState<string | null>(null);
  const [callDialogOpen, setCallDialogOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportCategory, setSupportCategory] = useState<string | undefined>(undefined);

  const openSupport = useCallback((category?: string) => {
    setSupportCategory(category);
    setSupportOpen(true);
  }, []);
  const [timelineRefreshKey, setTimelineRefreshKey] = useState(0);
  const agentPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function handlePotentialFieldSave(field: keyof UpdatePotentialPayload, raw: string, reason?: string) {
    if (!dealId) return;
    const payload: UpdatePotentialPayload = {};
    if (field === "amount" || field === "probability") {
      const n = parseFloat(raw);
      if (!isNaN(n)) (payload as Record<string, unknown>)[field] = n;
    } else {
      (payload as Record<string, unknown>)[field] = raw;
    }
    if (field === "stage" && reason) {
      const reasonField = reasonFieldForStage(raw);
      if (reasonField) payload[reasonField] = reason;
    }
    const updated = await updatePotential(dealId, payload);
    setDetail(updated);
  }

  useEffect(() => {
    if (!dealId) {
      setDetail(null);
      setAgentsRunning(false);
      return;
    }
    // Reset tab to initialTab (or details) when deal changes
    setActiveTab(initialTab ?? "details");
    let cancelled = false;
    setLoading(true);
    setError(null);
    getPotentialDetail(dealId)
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch(() => { if (!cancelled) setError("Failed to load details"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    getAiHighlight(dealId).then((h) => { if (!cancelled) setAiHighlight(h); });
    return () => { cancelled = true; };
  }, [dealId, initialTab]);

  // Poll all agent results to show global running indicator.
  // Stop polling if the pending agents have been running > 2hrs — they're stuck.
  const STUCK_MS = 2 * 60 * 60 * 1000;
  const checkAgentStatus = useCallback(async () => {
    if (!dealId) return;
    try {
      const results = await getAllAgentResults(dealId);
      const pendings = results.filter((r) => r.status === "pending" || r.status === "running");
      const hasPending = pendings.length > 0;
      const allStuck = hasPending && pendings.every((r) => {
        if (!r.triggeredAt) return false;
        const ts = r.triggeredAt.endsWith("Z") ? r.triggeredAt : r.triggeredAt + "Z";
        const started = new Date(ts).getTime();
        return !isNaN(started) && Date.now() - started > STUCK_MS;
      });
      // Hide the "Agents running" pill once stuck — no point signalling active work.
      setAgentsRunning(hasPending && !allStuck);
      if ((!hasPending || allStuck) && agentPollRef.current) {
        clearInterval(agentPollRef.current);
        agentPollRef.current = null;
      }
    } catch { setAgentsRunning(false); }
  }, [dealId]);

  useEffect(() => {
    if (!dealId) return;
    checkAgentStatus();
    agentPollRef.current = setInterval(checkAgentStatus, 5000);
    return () => { if (agentPollRef.current) clearInterval(agentPollRef.current); };
  }, [dealId, checkAgentStatus]);

  const hasSelection = !!(queueItemId || dealId || accountId);

  // Empty state
  if (!hasSelection) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center p-8 bg-slate-50">
        <div className="w-16 h-16 rounded-2xl bg-white border border-slate-200 flex items-center justify-center mb-4 shadow-sm">
          <Building2 className="h-8 w-8 text-slate-300" />
        </div>
        <p className="text-sm font-medium text-slate-500">Select an item to view details</p>
        <p className="text-xs text-slate-400 mt-1">Choose a contact, potential, or account from the list</p>
      </div>
    );
  }

  // Account view
  if (accountId && !dealId) {
    return (
      <AccountDetailPanel
        accountId={accountId}
        onPotentialNavigate={onPotentialNavigate ?? (() => {})}
      />
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden bg-white">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-slate-200 px-4 py-3">
        {loading && !detail ? (
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
            <span className="text-sm text-slate-400">Loading...</span>
          </div>
        ) : error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : detail ? (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              {/* Row 1: Potential name + number + stage */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-slate-900 truncate">
                  {detail.title || detail.company?.name || "(untitled)"}
                </span>
                {detail.potentialNumber && (
                  <span className="text-[10px] font-mono font-semibold text-slate-500 bg-slate-100 rounded px-1.5 py-0.5">
                    #{detail.potentialNumber}
                  </span>
                )}
                {detail.stage && (
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium capitalize ${STAGE_COLORS[detail.stage] ?? "bg-slate-100 text-slate-600"}`}>
                    {detail.stage}
                  </span>
                )}
                {detail.value != null && (
                  <span className="text-xs font-semibold text-emerald-600">
                    ${Number(detail.value).toLocaleString()}
                  </span>
                )}
              </div>

              {/* Row 2: Company + Contact */}
              <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                {detail.company?.name && (
                  <span className="flex items-center gap-1">
                    <Building2 className="h-3 w-3 text-slate-400" />
                    {detail.company.name}
                  </span>
                )}
                {detail.contact?.name && (
                  <span className="flex items-center gap-1">
                    <User className="h-3 w-3 text-slate-400" />
                    {detail.contact.name}
                    {detail.contact.title && <span className="text-slate-400">· {detail.contact.title}</span>}
                  </span>
                )}
              </div>

              {/* Row 3: AI highlight */}
              {aiHighlight && (
                <p className="text-[11px] text-blue-600 mt-1 italic leading-snug flex items-center gap-1">
                  <Bot className="h-3 w-3 shrink-0" />
                  {aiHighlight}
                </p>
              )}
            </div>

            {/* Agents running indicator */}
            {agentsRunning && (
              <div className="flex items-center gap-1.5 rounded-full bg-blue-50 border border-blue-200 px-2.5 py-1">
                <Bot className="h-3 w-3 text-blue-500 shrink-0" />
                <span className="text-[11px] font-medium text-blue-600">Agents running</span>
                <span className="flex h-1.5 w-1.5 shrink-0">
                  <span className="animate-ping absolute inline-flex h-1.5 w-1.5 rounded-full bg-blue-400 opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-blue-500" />
                </span>
              </div>
            )}

            {/* Call button */}
            {dealId && (
              <button
                onClick={() => setCallDialogOpen(true)}
                title="Call contact"
                className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 transition-colors"
              >
                <Phone className="h-3.5 w-3.5" />
                Call
              </button>
            )}

            {/* Support button */}
            {dealId && (
              <button
                onClick={() => { setSupportCategory(undefined); setSupportOpen(true); }}
                title="Contact support"
                className="flex-shrink-0 inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500 hover:text-slate-700 hover:bg-slate-50 transition-colors"
              >
                <Headphones className="h-3.5 w-3.5" />
              </button>
            )}

            {/* Complete button — queue mode only (not for emails-sent or meeting-briefs) */}
            {queueItemId && onComplete && folderType !== "emails-sent" && folderType !== "meeting-briefs" && (
              <button
                onClick={onComplete}
                className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 transition-colors"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Done
              </button>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-400">No details available</p>
        )}
      </div>

      {/* Tab bar */}
      <TabBar activeTab={activeTab} onTabChange={setActiveTab} hasDeal={!!dealId} />

      {/* Tab content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {activeTab === "details" && (
          loading && !detail ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          ) : detail ? (
            <DetailsTab detail={detail} availableStages={availableStages} availableServices={availableServices} onFieldSave={handlePotentialFieldSave} />
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-sm text-slate-400">No details available</p>
            </div>
          )
        )}

        {activeTab === "notes" && dealId && <NotesTab dealId={dealId} />}
        {activeTab === "todos" && dealId && <TodosTab dealId={dealId} />}

        {activeTab === "action" && dealId && <NextActionTab dealId={dealId} detail={detail} onEmailSent={onEmailSent} onRequestSupport={openSupport} />}
        {activeTab === "research" && dealId && <AgentResultTab dealId={dealId} tabType="research" emptyLabel="No research results yet" emptyDescription="AI research agents will populate this tab after analysing the potential" onRequestSupport={openSupport} />}
        {activeTab === "emails" && dealId && (
          <EmailsTab
            dealId={dealId}
            contactEmail={detail?.contact?.email ?? null}
            contactName={detail?.contact?.name ?? null}
          />
        )}
        {activeTab === "emails" && !dealId && <StubTab label="Email Thread" icon={Inbox} />}
        {activeTab === "solution" && dealId && <AgentResultTab dealId={dealId} tabType="solution_brief" emptyLabel="No solution brief yet" emptyDescription="The solution brief agent will generate content based on the potential details" onRequestSupport={openSupport} />}
        {activeTab === "files" && dealId && <FilesTab dealId={dealId} />}
        {activeTab === "files" && !dealId && <StubTab label="Files" icon={FolderOpen} />}
        {activeTab === "timeline" && dealId && <TimelineTab dealId={dealId} refreshKey={timelineRefreshKey} />}
        {activeTab === "chat" && dealId && <ChatTab dealId={dealId} />}
      </div>

      {/* Support email modal */}
      {dealId && (
        <SupportEmailModal
          isOpen={supportOpen}
          onClose={() => setSupportOpen(false)}
          dealId={dealId}
          detail={detail}
          defaultCategory={supportCategory}
        />
      )}

      {/* Call dialog */}
      {callDialogOpen && dealId && (
        <CallDialog
          potentialId={dealId}
          potentialName={detail?.title ?? detail?.company?.name ?? null}
          onClose={(callSaved) => {
            setCallDialogOpen(false);
            if (callSaved) {
              // Bump the timeline refresh key so it re-fetches with the new call activity
              setTimelineRefreshKey((k) => k + 1);
            }
          }}
        />
      )}
    </div>
  );
}
