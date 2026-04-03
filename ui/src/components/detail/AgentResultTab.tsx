import { useEffect, useRef, useState, useCallback } from "react";
import { Loader2, RefreshCw, AlertCircle, Bot } from "lucide-react";
import { getAgentResults, triggerAgent } from "@/lib/api";
import type { AgentResult } from "@/types";

// ── Simple markdown renderer ──────────────────────────────────────────────────

const URL_RE = /https?:\/\/[^\s\)>'"]+/g;

function renderInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    const boldIdx = remaining.indexOf("**");
    const urlMatch = URL_RE.exec(remaining);
    URL_RE.lastIndex = 0;

    const nextBold = boldIdx === -1 ? Infinity : boldIdx;
    const nextUrl = urlMatch ? urlMatch.index : Infinity;

    if (nextBold === Infinity && nextUrl === Infinity) {
      nodes.push(remaining);
      break;
    }

    if (nextBold <= nextUrl) {
      if (boldIdx > 0) nodes.push(remaining.slice(0, boldIdx));
      const endBold = remaining.indexOf("**", boldIdx + 2);
      if (endBold === -1) { nodes.push(remaining); break; }
      nodes.push(<strong key={key++}>{remaining.slice(boldIdx + 2, endBold)}</strong>);
      remaining = remaining.slice(endBold + 2);
    } else {
      if (urlMatch!.index > 0) nodes.push(remaining.slice(0, urlMatch!.index));
      const url = urlMatch![0];
      nodes.push(
        <a key={key++} href={url} target="_blank" rel="noopener noreferrer"
          className="text-blue-600 hover:underline break-all">{url}</a>
      );
      remaining = remaining.slice(urlMatch!.index + url.length);
    }
  }
  return nodes;
}

function MarkdownBlock({ content }: { content: string }) {
  const paragraphs = content.split(/\n{2,}/);
  return (
    <div className="space-y-3 text-sm text-slate-700 leading-relaxed">
      {paragraphs.map((para, i) => {
        const lines = para.split("\n").filter(Boolean);
        if (lines.length === 0) return null;
        const isListBlock = lines.every((l) => l.trimStart().startsWith("- ") || l.trimStart().startsWith("* "));
        if (isListBlock) {
          return (
            <ul key={i} className="list-disc list-inside space-y-1">
              {lines.map((l, j) => (
                <li key={j}>{renderInline(l.replace(/^[\s\-\*]+/, ""))}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i}>
            {lines.flatMap((line, j) => [
              ...renderInline(line),
              j < lines.length - 1 ? <br key={`br-${j}`} /> : null,
            ]).filter(Boolean)}
          </p>
        );
      })}
    </div>
  );
}

// ── Agent result card ─────────────────────────────────────────────────────────

function AgentCard({ result, onRetrigger }: { result: AgentResult; onRetrigger: (agentId: string) => void }) {
  const [retriggering, setRetriggering] = useState(false);

  async function handleRetrigger() {
    setRetriggering(true);
    try { await onRetrigger(result.agentId); } finally { setRetriggering(false); }
  }

  return (
    <div className="rounded-lg border border-slate-200 overflow-hidden">
      {/* Card header */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200">
        <div className="flex items-center gap-1.5 min-w-0">
          <Bot className="h-3.5 w-3.5 text-slate-400 shrink-0" />
          <span className="text-xs font-medium text-slate-600 truncate">{result.agentName}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {result.completedAt && (
            <span className="text-[10px] text-slate-400">
              {new Date(result.completedAt.endsWith("Z") ? result.completedAt : result.completedAt + "Z")
                .toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            </span>
          )}
          {(result.status === "completed" || result.status === "error") && (
            <button
              onClick={handleRetrigger}
              disabled={retriggering}
              title="Re-run agent"
              className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition-colors"
            >
              {retriggering
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <RefreshCw className="h-3 w-3" />}
            </button>
          )}
        </div>
      </div>

      {/* Card body */}
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
            <MarkdownBlock content={result.content} />
          )
        ) : (
          <p className="text-xs text-slate-400 py-1">No content available.</p>
        )}
      </div>
    </div>
  );
}

// ── Main exported component ───────────────────────────────────────────────────

interface AgentResultTabProps {
  dealId: string;
  tabType: string;
  emptyLabel?: string;
  emptyDescription?: string;
}

export default function AgentResultTab({ dealId, tabType, emptyLabel, emptyDescription }: AgentResultTabProps) {
  const [results, setResults] = useState<AgentResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const hasPending = results.some((r) => r.status === "pending" || r.status === "running");

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
    if (hasPending) {
      pollRef.current = setInterval(load, 5000);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [hasPending, load]);

  async function handleRetrigger(agentId: string) {
    const updated = await triggerAgent(dealId, agentId);
    setResults((prev) => prev.map((r) => r.agentId === agentId ? updated : r));
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
        <p className="text-xs text-slate-400 mt-1">{emptyDescription ?? "Results will appear here once agents complete"}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-3 space-y-3">
      {results.map((result) => (
        <AgentCard key={result.agentId} result={result} onRetrigger={handleRetrigger} />
      ))}
    </div>
  );
}
