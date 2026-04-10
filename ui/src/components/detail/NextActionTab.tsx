/**
 * NextActionTab — wraps AgentResultTab for the "action" tab.
 *
 * When the FRE agent completes, instead of showing raw markdown, renders the
 * content inside an EmailComposer (with To, CC, BCC, subject, rich body,
 * Send + Save Draft). While the agent is still running, shows a loading state.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { Loader2, Bot, AlertCircle, Mail } from "lucide-react";
import { getAgentResults } from "@/lib/api";
import type { AgentResult, PotentialDetail } from "@/types";
import EmailComposer from "./EmailComposer";
import type { EmailDraft } from "@/types";

interface NextActionTabProps {
  dealId: string;
  detail: PotentialDetail | null;
}

/**
 * Parse the FRE agent content to extract subject + body.
 *
 * The agent typically outputs markdown like:
 *   Subject: Re: Your Inquiry about Video Editing
 *
 *   Dear John,
 *
 *   Thank you for ...
 *
 * We extract the subject line and treat the rest as the email body.
 * If no "Subject:" prefix is found, the first line becomes the subject.
 */
function parseFREDraft(content: string): { subject: string; body: string } {
  if (!content) return { subject: "", body: "" };

  const lines = content.split("\n");
  let subject = "";
  let bodyStart = 0;

  // Look for "Subject:" line (case-insensitive)
  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    const match = lines[i].match(/^(?:subject|sub|re)\s*:\s*(.+)/i);
    if (match) {
      subject = match[1].trim();
      bodyStart = i + 1;
      // Skip blank lines after subject
      while (bodyStart < lines.length && !lines[bodyStart].trim()) bodyStart++;
      break;
    }
  }

  // If no subject found, use first non-empty line
  if (!subject) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim()) {
        subject = lines[i].trim().replace(/^#+\s*/, ""); // strip markdown heading
        bodyStart = i + 1;
        break;
      }
    }
  }

  const body = lines.slice(bodyStart).join("\n").trim();

  // Convert markdown body to simple HTML for the TipTap editor
  const htmlBody = body
    .split("\n\n")
    .map((para) => {
      const escaped = para
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\n/g, "<br>");
      return `<p>${escaped}</p>`;
    })
    .join("");

  return { subject, body: htmlBody };
}

export default function NextActionTab({ dealId, detail }: NextActionTabProps) {
  const [results, setResults] = useState<AgentResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [composerOpen, setComposerOpen] = useState(false);
  const [draftFromAgent, setDraftFromAgent] = useState<{ subject: string; body: string } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const hasPending = results.some((r) => r.status === "pending" || r.status === "running");
  const completedResult = results.find((r) => r.status === "completed" && r.content);
  const errorResult = results.find((r) => r.status === "error");

  const load = useCallback(async () => {
    try {
      const data = await getAgentResults(dealId, "next_action");
      setResults(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    load();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [load]);

  // Poll while pending
  useEffect(() => {
    if (hasPending) {
      pollRef.current = setInterval(load, 5000);
    } else {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [hasPending, load]);

  // When agent completes, parse the FRE draft
  useEffect(() => {
    if (completedResult?.content) {
      setDraftFromAgent(parseFREDraft(completedResult.content));
    }
  }, [completedResult]);

  // Build the EmailDraft-like object for the composer
  const contactEmail = detail?.contact?.email ?? null;
  const contactName = detail?.contact?.name ?? null;

  function handleOpenComposer() {
    setComposerOpen(true);
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    );
  }

  // Composer mode — full email editor
  if (composerOpen && draftFromAgent) {
    const initialDraft: EmailDraft = {
      id: 0,
      potentialId: dealId,
      toEmail: contactEmail ?? "",
      toName: contactName ?? "",
      ccEmails: [],
      bccEmails: [],
      subject: draftFromAgent.subject,
      body: draftFromAgent.body,
      replyToThreadId: null,
      replyToMessageId: null,
      status: "draft",
      createdTime: new Date().toISOString(),
      updatedTime: new Date().toISOString(),
    };

    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <EmailComposer
          dealId={dealId}
          initialDraft={initialDraft}
          contactEmail={contactEmail}
          contactName={contactName}
          signature={null}
          onClose={() => setComposerOpen(false)}
          onSent={() => setComposerOpen(false)}
          onDraftSaved={() => {}}
        />
      </div>
    );
  }

  // Agent still running
  if (hasPending) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-12">
        <div className="w-14 h-14 rounded-2xl bg-blue-50 flex items-center justify-center mb-4">
          <Bot className="h-6 w-6 text-blue-500 animate-pulse" />
        </div>
        <p className="text-sm font-semibold text-slate-700 mb-1">Preparing FRE Draft</p>
        <p className="text-xs text-slate-500 max-w-sm">
          The AI agent is researching the potential and drafting a First Response Email. This typically takes 20–40 seconds.
        </p>
        <div className="flex items-center gap-2 mt-4 text-xs text-slate-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Agent working…
        </div>
      </div>
    );
  }

  // Error
  if (errorResult) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-12">
        <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-xs text-red-600 max-w-md">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">FRE Draft generation failed</p>
            <p className="mt-0.5">{errorResult.errorMessage || "Unknown error"}</p>
          </div>
        </div>
      </div>
    );
  }

  // Agent completed — show the draft preview + "Open in Email Composer" button
  if (draftFromAgent) {
    return (
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="px-4 py-4 space-y-4">
          {/* Draft preview card */}
          <div className="rounded-lg border border-slate-200 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <Mail className="h-3.5 w-3.5 text-slate-400" />
                <span className="text-xs font-semibold text-slate-600">FRE Draft — Ready to Send</span>
              </div>
              <button
                onClick={handleOpenComposer}
                className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-700 transition-colors shadow-sm"
              >
                <Mail className="h-3 w-3" />
                Open in Composer
              </button>
            </div>

            <div className="px-4 py-3 space-y-3">
              {/* To */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold text-slate-400 uppercase w-12 shrink-0">To</span>
                <span className="text-xs text-slate-700">{contactEmail || "—"}</span>
              </div>

              {/* Subject */}
              <div className="flex items-start gap-2">
                <span className="text-[10px] font-semibold text-slate-400 uppercase w-12 shrink-0 pt-0.5">Subject</span>
                <span className="text-xs font-medium text-slate-800">{draftFromAgent.subject || "—"}</span>
              </div>

              {/* Body preview */}
              <div className="border-t border-slate-100 pt-3">
                <div
                  className="text-sm text-slate-700 leading-relaxed prose prose-sm max-w-none"
                  dangerouslySetInnerHTML={{ __html: draftFromAgent.body }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // No results at all
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-12">
      <Bot className="h-8 w-8 text-slate-300 mb-2" />
      <p className="text-sm text-slate-500">Waiting for next action</p>
      <p className="text-xs text-slate-400 mt-1 max-w-xs">
        The agent will automatically generate an FRE draft or meeting prep based on the potential.
      </p>
    </div>
  );
}
