import { useEffect, useRef, useState, useCallback } from "react";
import { Loader2, RefreshCw, AlertCircle, Bot, Play, ChevronDown, LifeBuoy, Clock } from "lucide-react";
import { getAgentResults, runAllAgents } from "@/lib/api";
import type { AgentResult } from "@/types";
import MarkdownBlock from "@/components/chat/MarkdownBlock";

/**
 * Some agents emit bullet lists smushed onto one line:
 *   "*   Item A   *   Item B   *   Item C   *"
 *   "Item A   *   Item B   *   Item C   *"   ← first item has no leading marker
 *
 * Step 1: inject newlines before each mid-line "* " (or "- ") bullet marker.
 * Step 2: if the first non-empty line is plain text but subsequent lines ARE
 *   bullets (result of step 1), promote the first line to a bullet item too —
 *   some agents omit the leading marker on the very first item.
 */
function splitInlineBullets(raw: string): string {
  // Step 1 — split mid-line markers
  const split = raw.replace(/(\S)\s{2,}([*-])\s+/g, "$1\n$2 ");

  // Step 2 — promote an un-bulleted first line when the rest are bullets
  const lines = split.split("\n");
  const firstIdx = lines.findIndex((l) => l.trim().length > 0);
  if (firstIdx >= 0 && !/^\s*[-*]\s/.test(lines[firstIdx])) {
    const hasBulletAfter = lines.slice(firstIdx + 1).some((l) => /^\s*[-*]\s/.test(l));
    if (hasBulletAfter) {
      lines[firstIdx] = "* " + lines[firstIdx].trimStart();
      return lines.join("\n");
    }
  }
  return split;
}

// ── Agent result card ─────────────────────────────────────────────────────────

function AgentCard({ result }: { result: AgentResult }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="rounded-lg border border-slate-200 overflow-hidden">
      {/* Card header — click to toggle */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200 hover:bg-slate-100 transition-colors text-left"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <ChevronDown
            className={`h-3.5 w-3.5 text-slate-400 shrink-0 transition-transform ${expanded ? "" : "-rotate-90"}`}
          />
          <Bot className="h-3.5 w-3.5 text-slate-400 shrink-0" />
          <span className="text-xs font-medium text-slate-600 truncate">{result.agentName}</span>
        </div>
        {result.completedAt && (
          <span className="text-[10px] text-slate-400 shrink-0">
            {new Date(result.completedAt.endsWith("Z") ? result.completedAt : result.completedAt + "Z")
              .toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </span>
        )}
      </button>

      {/* Card body — hidden when collapsed */}
      {expanded && (
        <div className="px-3 py-3">
          {result.status === "pending" || result.status === "running" ? (
            <div className="flex items-center gap-2 text-slate-400 py-2">
              <Loader2 className="h-4 w-4 animate-spin shrink-0" />
              <span className="text-xs">Agent is running…</span>
            </div>
          ) : result.status === "error" ? (
            <div className="flex items-start gap-2 text-red-500 py-1">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span className="text-xs">{result.errorMessage || "Agent run failed"}</span>
            </div>
          ) : result.content ? (
            result.contentType === "html" ? (
              <div
                className="prose prose-sm max-w-none text-slate-700"
                dangerouslySetInnerHTML={{ __html: result.content }}
              />
            ) : (
              <MarkdownBlock content={splitInlineBullets(result.content)} compact />
            )
          ) : (
            <p className="text-xs text-slate-400 py-1">No content available.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main exported component ───────────────────────────────────────────────────

interface AgentResultTabProps {
  dealId: string;
  tabType: string;
  emptyLabel?: string;
  emptyDescription?: string;
  hideControls?: boolean;
  onRequestSupport?: (category?: string) => void;
}

// Stop polling and flag as stuck if any pending agent has been running for this long.
const STUCK_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

function isPendingStuck(results: AgentResult[]): boolean {
  const pendings = results.filter((r) => r.status === "pending" || r.status === "running");
  if (pendings.length === 0) return false;
  const now = Date.now();
  return pendings.every((r) => {
    const ts = r.triggeredAt;
    if (!ts) return false;
    const started = new Date(ts.endsWith("Z") ? ts : ts + "Z").getTime();
    if (isNaN(started)) return false;
    return now - started > STUCK_THRESHOLD_MS;
  });
}

export default function AgentResultTab({ dealId, tabType, emptyLabel, emptyDescription, hideControls = false, onRequestSupport }: AgentResultTabProps) {
  const [results, setResults] = useState<AgentResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const hasPending = results.some((r) => r.status === "pending" || r.status === "running");
  const stuck = hasPending && isPendingStuck(results);

  const load = useCallback(async () => {
    try {
      const data = await getAgentResults(dealId, tabType);
      setResults(data);
      setError(null);
    } catch {
      setError("Failed to load results");
    } finally {
      setLoading(false);
    }
  }, [dealId, tabType]);

  // Poll every 5s while any result is pending/running
  useEffect(() => {
    load();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [load]);

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    // Stop polling once agents have been pending > 2hrs — they're stuck.
    if (hasPending && !stuck) {
      pollRef.current = setInterval(load, 5000);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [hasPending, stuck, load]);

  async function handleRunAll() {
    setRunning(true);
    try {
      await runAllAgents(dealId);
      await load();
    } catch {
      // ignore
    } finally {
      setRunning(false);
    }
  }

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

  if (results.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mb-3">
          <Bot className="h-5 w-5 text-slate-400" />
        </div>
        <p className="text-sm font-medium text-slate-500">{emptyLabel ?? "No agent results yet"}</p>
        <p className="text-xs text-slate-400 mt-1 mb-4">{emptyDescription ?? "Agents haven't run for this potential yet."}</p>
        {!hideControls && (
          <button
            onClick={handleRunAll}
            disabled={running}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 transition-colors disabled:opacity-60"
          >
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            {running ? "Triggering…" : "Run Agents"}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">
          {results.length} agent{results.length !== 1 ? "s" : ""}
        </span>
        {!hideControls && (
          <button
            onClick={handleRunAll}
            disabled={running || (hasPending && !stuck)}
            title="Re-run all agents"
            className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-slate-700 disabled:opacity-40 transition-colors"
          >
            {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Re-run all
          </button>
        )}
      </div>

      {stuck && (
        <StuckBanner onRequestSupport={onRequestSupport} />
      )}

      {results.map((result) => (
        <AgentCard key={result.agentId} result={result} />
      ))}
    </div>
  );
}

function StuckBanner({ onRequestSupport }: { onRequestSupport?: (category?: string) => void }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
      <div className="flex items-start gap-2">
        <Clock className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-amber-900">This is taking longer than usual</p>
          <p className="text-[11px] text-amber-700 mt-0.5 leading-relaxed">
            The agent hasn't returned results in over 2 hours. It may be stuck. Please contact support for help.
          </p>
          {onRequestSupport && (
            <button
              onClick={() => onRequestSupport("agent_stuck")}
              className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-amber-700 transition-colors"
            >
              <LifeBuoy className="h-3 w-3" />
              Contact Support
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
