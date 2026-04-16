/**
 * NextActionTab — wraps AgentResultTab for the "action" tab.
 *
 * When the FRE agent completes, instead of showing raw markdown, renders the
 * content inside an EmailComposer (with To, CC, BCC, subject, rich body,
 * Send + Save Draft). While the agent is still running, shows a loading state.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { Loader2, Bot, AlertCircle, Mail, CheckCircle2, Clock, LifeBuoy } from "lucide-react";
import { getAgentResults, getEmailDrafts, deleteEmailDraft } from "@/lib/api";
import type { AgentResult, PotentialDetail, EmailDraft } from "@/types";
import EmailComposer from "./EmailComposer";

interface NextActionTabProps {
  dealId: string;
  detail: PotentialDetail | null;
  onEmailSent?: () => void;
  onRequestSupport?: (category?: string) => void;
}

const STUCK_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Parse the FRE agent content to extract subject + body.
 *
 * Handles variants like:
 *   Subject: Re: Your Inquiry
 *   **Subject:** Re: Your Inquiry
 *   ### Subject: Re: Your Inquiry
 *   Subject Line: Re: Your Inquiry
 *
 * If no "Subject:" prefix is found, the first non-empty line becomes the subject.
 */
function parseFREDraft(rawContent: string): { subject: string; body: string } {
  if (!rawContent) return { subject: "", body: "" };
  // Normalize line endings — agents may emit \r\n (Windows) or \r (legacy Mac).
  // Without this the paragraph split below misses every break.
  const content = rawContent.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Strip markdown wrappers (bold, heading, blockquote) from the start of a line
  // so "**Subject:** Foo" or "### Subject: Foo" still matches.
  const stripPrefix = (s: string) => s
    .replace(/^[>\s]*#{1,6}\s*/, "")   // heading
    .replace(/^\*{1,3}/, "")            // bold/italic open
    .trimStart();

  const stripTrailingMd = (s: string) => s
    .replace(/\*{1,3}$/, "")            // bold/italic close
    .trim();

  const lines = content.split("\n");
  let subject = "";
  let bodyStart = 0;

  for (let i = 0; i < Math.min(lines.length, 8); i++) {
    const stripped = stripPrefix(lines[i]);
    const match = stripped.match(/^subject(?:\s*line)?\s*:\s*\**\s*(.+)/i);
    if (match) {
      subject = stripTrailingMd(match[1]);
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
        subject = stripTrailingMd(stripPrefix(lines[i]));
        bodyStart = i + 1;
        break;
      }
    }
  }

  const body = lines.slice(bodyStart).join("\n").trim();

  // Convert markdown body to simple HTML for the TipTap editor.
  // Split on 1+ blank lines so 2, 3, or more consecutive \n all create paragraph breaks.
  const htmlBody = body
    .split(/\n\s*\n/)
    .map((para) => para.trim())
    .filter((para) => para.length > 0)
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

export default function NextActionTab({ dealId, detail, onEmailSent, onRequestSupport }: NextActionTabProps) {
  const [results, setResults] = useState<AgentResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [composerOpen, setComposerOpen] = useState(false);
  const [draftFromAgent, setDraftFromAgent] = useState<{ subject: string; body: string } | null>(null);
  // savedDraft: the most recently saved draft for this potential (from DB).
  // When set, the composer opens with this instead of the raw agent content.
  const [savedDraft, setSavedDraft] = useState<EmailDraft | null>(null);
  // emailSent: set to the sent subject after the FRE is successfully sent
  const [emailSent, setEmailSent] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const hasPending = results.some((r) => r.status === "pending" || r.status === "running");
  const completedResult = results.find((r) => r.status === "completed" && r.content);
  const errorResult = results.find((r) => r.status === "error");
  const stuck = hasPending && results
    .filter((r) => r.status === "pending" || r.status === "running")
    .every((r) => {
      if (!r.triggeredAt) return false;
      const started = new Date(r.triggeredAt.endsWith("Z") ? r.triggeredAt : r.triggeredAt + "Z").getTime();
      if (isNaN(started)) return false;
      return Date.now() - started > STUCK_THRESHOLD_MS;
    });

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

  // Poll while pending, but stop once we detect the agent is stuck (>2hrs)
  useEffect(() => {
    if (hasPending && !stuck) {
      pollRef.current = setInterval(load, 5000);
    } else {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [hasPending, stuck, load]);

  // When agent completes, parse the FRE draft
  useEffect(() => {
    if (completedResult?.content) {
      setDraftFromAgent(parseFREDraft(completedResult.content));
    }
  }, [completedResult]);

  // On mount, check if user already saved a draft for this potential.
  // If so, that takes precedence over the raw agent content when opening composer.
  // If multiple drafts exist (from before the upsert fix), keep only the newest
  // and soft-delete the rest so the Emails tab doesn't show duplicates.
  useEffect(() => {
    getEmailDrafts(dealId)
      .then((drafts) => {
        if (drafts.length === 0) return;
        setSavedDraft(drafts[0]); // most recently updated
        // Prune stale duplicates silently
        drafts.slice(1).forEach((d) => deleteEmailDraft(dealId, d.id).catch(() => {}));
      })
      .catch(() => {});
  }, [dealId]);

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
  if (composerOpen && (savedDraft || draftFromAgent)) {
    // Prefer the user's saved draft over the raw agent content
    const initialDraft: EmailDraft = savedDraft ?? {
      id: 0, // sentinel: not yet persisted; EmailComposer treats 0 as null
      potentialId: dealId,
      toEmail: contactEmail ?? "",
      toName: contactName ?? "",
      ccEmails: [],
      bccEmails: [],
      subject: draftFromAgent!.subject,
      body: draftFromAgent!.body,
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
          onSent={() => {
            setComposerOpen(false);
            setEmailSent(initialDraft.subject ?? "Email");
            setSavedDraft(null);
            onEmailSent?.();
          }}
          onDraftSaved={(draft) => setSavedDraft(draft)}
        />
      </div>
    );
  }

  // Agent appears stuck — has been pending > 2hrs
  if (stuck) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-12">
        <div className="w-14 h-14 rounded-2xl bg-amber-50 flex items-center justify-center mb-4">
          <Clock className="h-7 w-7 text-amber-500" />
        </div>
        <p className="text-sm font-semibold text-slate-700 mb-1">This is taking longer than usual</p>
        <p className="text-xs text-slate-500 max-w-sm">
          The AI agent hasn't returned a result in over 2 hours. It may be stuck.
          Please contact support so we can investigate.
        </p>
        {onRequestSupport && (
          <button
            onClick={() => onRequestSupport("agent_stuck")}
            className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 transition-colors"
          >
            <LifeBuoy className="h-3.5 w-3.5" />
            Contact Support
          </button>
        )}
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

  // Email sent in this session — show confirmation
  if (emailSent) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-8">
        <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center mb-4">
          <CheckCircle2 className="h-7 w-7 text-emerald-500" />
        </div>
        <p className="text-sm font-semibold text-slate-700 mb-1">Action Completed</p>
        <p className="text-xs text-slate-500 max-w-sm">
          <span className="font-medium text-slate-600">"{emailSent}"</span> was delivered to{" "}
          {contactEmail || "the contact"}.
        </p>
        <p className="text-xs text-slate-400 mt-3">
          The inquiry has been moved out of New Inquiries.
        </p>
      </div>
    );
  }

  // No active next action (backend returned empty — insight is "actioned" or none exists).
  // This is the persisted state across refreshes — don't show the draft preview here.
  if (results.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-12">
        <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center mb-4">
          <CheckCircle2 className="h-7 w-7 text-emerald-500" />
        </div>
        <p className="text-sm font-semibold text-slate-700 mb-1">No Active Next Action</p>
        <p className="text-xs text-slate-400 mt-1 max-w-xs">
          The action for this potential has been completed or no next action has been assigned yet.
        </p>
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

  // Agent completed (or a saved draft exists) — show preview + "Open in Composer"
  const previewDraft = savedDraft
    ? { subject: savedDraft.subject ?? "", body: savedDraft.body ?? "" }
    : draftFromAgent;

  if (previewDraft) {
    return (
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="px-4 py-4 space-y-4">
          {/* Draft preview card */}
          <div className="rounded-lg border border-slate-200 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <Mail className="h-3.5 w-3.5 text-slate-400" />
                <span className="text-xs font-semibold text-slate-600">FRE Draft — Ready to Send</span>
                {savedDraft && (
                  <span className="text-[10px] font-medium text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-full px-1.5 py-0.5">
                    Saved
                  </span>
                )}
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
                <span className="text-xs font-medium text-slate-800">{previewDraft.subject || "—"}</span>
              </div>

              {/* Body preview */}
              <div className="border-t border-slate-100 pt-3">
                <div
                  className="text-sm text-slate-700 leading-relaxed prose prose-sm max-w-none"
                  dangerouslySetInnerHTML={{ __html: previewDraft.body }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Fallback — results exist but content not yet parsed
  return (
    <div className="flex-1 flex items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
    </div>
  );
}
