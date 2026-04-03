import { useState, useEffect } from "react";
import {
  Loader2,
  Building2,
  User,
  CheckCircle2,
  FolderOpen,
  Inbox,
} from "lucide-react";
import type { DetailTab, PotentialDetail } from "@/types";
import { getPotentialDetail, updatePotential } from "@/lib/api";
import type { UpdatePotentialPayload } from "@/lib/api";
import TabBar from "./TabBar";
import NotesTab from "./NotesTab";
import TodosTab from "./TodosTab";
import FilesTab from "./FilesTab";
import DetailsTab from "./DetailsTab";
import TimelineTab from "./TimelineTab";
import AgentResultTab from "./AgentResultTab";
import EmailsTab from "./EmailsTab";
import AccountDetailPanel from "@/components/accounts/AccountDetailPanel";

interface DetailPanelProps {
  queueItemId: string | null;
  dealId: string | null;
  accountId?: string | null;
  folderType: string;
  onComplete?: () => void;
  onPotentialNavigate?: (dealId: string) => void;
  availableStages?: string[];
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
  onComplete,
  onPotentialNavigate,
  availableStages = [],
}: DetailPanelProps) {
  const [activeTab, setActiveTab] = useState<DetailTab>("details");
  const [detail, setDetail] = useState<PotentialDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePotentialFieldSave(field: keyof UpdatePotentialPayload, raw: string) {
    if (!dealId) return;
    const payload: UpdatePotentialPayload = {};
    if (field === "amount" || field === "probability") {
      const n = parseFloat(raw);
      if (!isNaN(n)) (payload as Record<string, unknown>)[field] = n;
    } else {
      (payload as Record<string, unknown>)[field] = raw;
    }
    const updated = await updatePotential(dealId, payload);
    setDetail(updated);
  }

  useEffect(() => {
    if (!dealId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getPotentialDetail(dealId)
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch(() => { if (!cancelled) setError("Failed to load details"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [dealId]);

  const hasSelection = !!(queueItemId || dealId || accountId);

  // Empty state
  if (!hasSelection) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center p-8 bg-slate-50">
        <div className="w-16 h-16 rounded-2xl bg-white border border-slate-200 flex items-center justify-center mb-4 shadow-sm">
          <Building2 className="h-8 w-8 text-slate-300" />
        </div>
        <p className="text-sm font-medium text-slate-500">Select an item to view details</p>
        <p className="text-xs text-slate-400 mt-1">Choose a contact, deal, or account from the list</p>
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
              {/* Contact name + stage */}
              <div className="flex items-center gap-2 flex-wrap">
                {detail.contact?.name && (
                  <div className="flex items-center gap-1.5">
                    <User className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
                    <span className="text-sm font-semibold text-slate-900">
                      {detail.contact.name}
                    </span>
                  </div>
                )}
                {detail.stage && (
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium capitalize ${STAGE_COLORS[detail.stage] ?? "bg-slate-100 text-slate-600"}`}>
                    {detail.stage}
                  </span>
                )}
              </div>
              {/* Company */}
              {detail.company?.name && (
                <div className="flex items-center gap-1 mt-0.5">
                  <Building2 className="h-3 w-3 text-slate-400 flex-shrink-0" />
                  <span className="text-xs text-slate-500">{detail.company.name}</span>
                  {detail.company.industry && (
                    <span className="text-xs text-slate-400">· {detail.company.industry}</span>
                  )}
                </div>
              )}
              {/* Value */}
              {detail.value != null && (
                <p className="text-xs text-emerald-600 font-medium mt-0.5">
                  ${Number(detail.value).toLocaleString()}
                  {detail.title && (
                    <span className="text-slate-400 font-normal ml-1">· {detail.title}</span>
                  )}
                </p>
              )}
            </div>

            {/* Complete button — queue mode only */}
            {queueItemId && onComplete && (
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
            <DetailsTab detail={detail} availableStages={availableStages} onFieldSave={handlePotentialFieldSave} />
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-sm text-slate-400">No details available</p>
            </div>
          )
        )}

        {activeTab === "notes" && dealId && <NotesTab dealId={dealId} />}
        {activeTab === "todos" && dealId && <TodosTab dealId={dealId} />}

        {activeTab === "action" && dealId && <AgentResultTab dealId={dealId} tabType="next_action" emptyLabel="No next action draft yet" emptyDescription="The agent will generate a suggested next action email once triggered" />}
        {activeTab === "research" && dealId && <AgentResultTab dealId={dealId} tabType="research" emptyLabel="No research results yet" emptyDescription="AI research agents will populate this tab after analysing the potential" />}
        {activeTab === "emails" && dealId && (
          <EmailsTab
            dealId={dealId}
            contactEmail={detail?.contact?.email ?? null}
            contactName={detail?.contact?.name ?? null}
          />
        )}
        {activeTab === "emails" && !dealId && <StubTab label="Email Thread" icon={Inbox} />}
        {activeTab === "solution" && dealId && <AgentResultTab dealId={dealId} tabType="solution_brief" emptyLabel="No solution brief yet" emptyDescription="The solution brief agent will generate content based on the potential details" />}
        {activeTab === "files" && dealId && <FilesTab dealId={dealId} />}
        {activeTab === "files" && !dealId && <StubTab label="Files" icon={FolderOpen} />}
        {activeTab === "timeline" && dealId && <TimelineTab dealId={dealId} />}
      </div>
    </div>
  );
}
