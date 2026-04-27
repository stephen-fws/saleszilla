/**
 * NextActionTab — wraps AgentResultTab for the "action" tab.
 *
 * When the FRE agent completes, instead of showing raw markdown, renders the
 * content inside an EmailComposer (with To, CC, BCC, subject, rich body,
 * Send + Save Draft). While the agent is still running, shows a loading state.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { Loader2, Bot, AlertCircle, Mail, CheckCircle2, Clock, Headphones, X, CalendarClock, Users, MapPin, Video, ExternalLink, Paperclip } from "lucide-react";
import MarkdownBlock from "@/components/chat/MarkdownBlock";
import { getAgentResults, getEmailDrafts, deleteEmailDraft, getEmailSignature, getReplyContext, getEmailThreads, resolveNextAction, getMeetingInfo, listDraftAttachments, openDraftAttachment, removeDraftAttachment } from "@/lib/api";
import type { MeetingInfo } from "@/lib/api";
import type { SyncEmailThread, SyncEmailMessage } from "@/types";
import type { AgentResult, PotentialDetail, EmailDraft, DraftAttachment } from "@/types";
import EmailComposer from "./EmailComposer";

interface NextActionTabProps {
  dealId: string;
  detail: PotentialDetail | null;
  /**
   * Scopes Next Action rendering to one trigger_category (folder-driven lens).
   * When the user opens Panel 3 via the Reply folder, categoryHint="reply" →
   * only the reply insight is fetched/rendered, and Skip/Done/Send resolve
   * just that insight. When undefined (e.g., entered via Potentials list), the
   * backend returns all next_action categories and we pick a default below.
   */
  categoryHint?: string;
  /**
   * True when the viewing user is NOT the potential owner. Hides all
   * write actions (Open in Composer, Skip/Done on meeting prep, etc.) so
   * a manager can READ the draft but can't send/resolve on behalf of
   * a reportee (doing so would use the manager's own MS token/mailbox).
   */
  readOnly?: boolean;
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
  // Every \n becomes a <br> so the rendered output preserves the EXACT number
  // of line breaks the agent emitted — two \n = two visible line breaks, etc.
  const escaped = body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>");
  const htmlBody = `<p>${escaped}</p>`;

  return { subject, body: htmlBody };
}

interface MeetingBriefData {
  oneLiner: string | null;
  agenda: string | null;
  keyTalkingPoints: string[];
  questionsToAsk: string[];
}

/**
 * Parse the meeting-prep agent output into a structured object.
 * The agent emits a JSON object (usually inside a ```json fence) with a
 * `meeting_brief` key containing: one_liner, key_talking_points, agenda,
 * questions_to_ask. Returns null when parsing fails so callers can fall back
 * to a raw markdown render.
 */
function parseMeetingBrief(rawContent: string): MeetingBriefData | null {
  if (!rawContent) return null;

  // Extract JSON payload — prefer a ```json fence, fall back to any ``` fence,
  // finally try the whole string.
  const fenceMatch = rawContent.match(/```(?:json)?\s*\n([\s\S]*?)\n```/i);
  const jsonText = fenceMatch ? fenceMatch[1] : rawContent;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") return null;

  // Unwrap `meeting_brief` key if present, otherwise treat the object as the brief itself.
  const brief = (parsed as Record<string, unknown>).meeting_brief ?? parsed;
  if (!brief || typeof brief !== "object") return null;
  const b = brief as Record<string, unknown>;

  const asString = (v: unknown): string | null =>
    typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
  const asStringArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [];

  const data: MeetingBriefData = {
    oneLiner: asString(b.one_liner),
    agenda: asString(b.agenda),
    keyTalkingPoints: asStringArray(b.key_talking_points),
    questionsToAsk: asStringArray(b.questions_to_ask),
  };

  // If nothing parsed, treat as failure.
  if (!data.oneLiner && !data.agenda && data.keyTalkingPoints.length === 0 && data.questionsToAsk.length === 0) {
    return null;
  }
  return data;
}

function PriorMessage({ msg }: { msg: SyncEmailMessage }) {
  const [expanded, setExpanded] = useState(false);
  const isSent = msg.direction === "sent";
  const ts = msg.sentTime || msg.receivedTime;
  const senderName = (msg.fromEmail || "").split("@")[0].split(/[._-]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  const shortTs = ts
    ? new Date(ts.endsWith("Z") ? ts : ts + "Z").toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "";

  return (
    <div className="px-3 py-2">
      <button onClick={() => setExpanded((v) => !v)} className="w-full flex items-start gap-2 text-left">
        <div className={`flex h-6 w-6 items-center justify-center rounded-full shrink-0 mt-0.5 text-[9px] font-bold ${
          isSent ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700"
        }`}>
          {(msg.fromEmail || "?").slice(0, 2).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-slate-700 truncate">
              {senderName}
              {isSent && <span className="ml-1 text-[9px] text-emerald-600 font-normal">(You)</span>}
            </span>
            <span className="text-[10px] text-slate-400 shrink-0">{shortTs}</span>
          </div>
          {!expanded && (
            <p className="text-[10px] text-slate-400 truncate mt-0.5">
              {(msg.body || "").replace(/<[^>]*>/g, "").slice(0, 100)}
            </p>
          )}
        </div>
      </button>
      {expanded && (
        <div className="mt-2 ml-8 space-y-2">
          {/* Outlook-style recipient list — only shown when expanded */}
          <div className="text-[10px] text-slate-500 space-y-0.5">
            <div><span className="font-semibold text-slate-600">To:</span> {msg.toEmail || "—"}</div>
            {msg.cc && (
              <div><span className="font-semibold text-slate-600">CC:</span> {msg.cc}</div>
            )}
            {msg.bcc && (
              <div><span className="font-semibold text-slate-600">BCC:</span> {msg.bcc}</div>
            )}
          </div>
          {msg.body && (
            <div className="text-xs text-slate-600 leading-relaxed prose prose-sm max-w-none"
              dangerouslySetInnerHTML={{ __html: msg.body }}
            />
          )}
        </div>
      )}
    </div>
  );
}

export default function NextActionTab({ dealId, detail, categoryHint, readOnly = false, onEmailSent, onRequestSupport }: NextActionTabProps) {
  const [results, setResults] = useState<AgentResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [composerOpen, setComposerOpen] = useState(false);
  const [draftFromAgent, setDraftFromAgent] = useState<{ subject: string; body: string } | null>(null);
  // savedDraft: the most recently saved draft for this potential (from DB).
  // When set, the composer opens with this instead of the raw agent content.
  const [savedDraft, setSavedDraft] = useState<EmailDraft | null>(null);
  // emailSent: set to the sent subject after the FRE is successfully sent
  const [emailSent, setEmailSent] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [replyContext, setReplyContext] = useState<{ threadId: string | null; internetMessageId: string | null }>({ threadId: null, internetMessageId: null });
  const [priorThread, setPriorThread] = useState<SyncEmailThread | null>(null);
  const [loadingThread, setLoadingThread] = useState(false);
  const [meetingInfo, setMeetingInfo] = useState<MeetingInfo | null>(null);
  const [draftAttachments, setDraftAttachments] = useState<DraftAttachment[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const hasPending = results.some((r) => r.status === "pending" || r.status === "running");

  // completedResult picks which insight to render in the tab. When categoryHint
  // is set, the fetch is already scoped to one category and we just take the
  // first completed one. When no hint (e.g., entry via Potentials list / search),
  // prefer meeting_brief (time-bound) over other categories. Falls back to the
  // first completed result otherwise.
  const completedResult = (() => {
    const completed = results.filter((r) => r.status === "completed" && r.content);
    if (completed.length === 0) return undefined;
    if (categoryHint) return completed[0];
    const mb = completed.find((r) => r.triggerCategory === "meeting_brief");
    return mb ?? completed[0];
  })();

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
      const data = await getAgentResults(dealId, "next_action", categoryHint);
      setResults(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [dealId, categoryHint]);

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

  // When agent completes, parse the draft content based on triggerCategory:
  // - "newEnquiry" (FRE): extract subject from first line of agent output
  // - "followUp" / "reply": use prior thread's subject; entire agent output is body
  const isFRE = completedResult?.triggerCategory === "newEnquiry";

  useEffect(() => {
    if (completedResult?.content) {
      if (!isFRE) {
        // FU / Reply — entire agent output is the body, subject from prior thread
        const rawContent = completedResult.content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
        const escaped = rawContent
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
          .replace(/\n/g, "<br>");
        const threadSubject = priorThread?.subject || completedResult.agentName || "Follow Up";
        const subject = threadSubject.startsWith("RE:") || threadSubject.startsWith("Re:")
          ? threadSubject
          : `RE: ${threadSubject}`;
        setDraftFromAgent({ subject, body: `<p>${escaped}</p>` });
      } else {
        // FRE — extract subject from first line
        setDraftFromAgent(parseFREDraft(completedResult.content));
      }
    }
  }, [completedResult, priorThread]);

  // On mount, check if user already saved a draft for this potential.
  // If so, that takes precedence over the raw agent content when opening composer.
  // If multiple drafts exist (from before the upsert fix), keep only the newest
  // and soft-delete the rest so the Emails tab doesn't show duplicates.
  useEffect(() => {
    getEmailDrafts(dealId, true)
      .then((drafts) => {
        if (drafts.length === 0) return;
        setSavedDraft(drafts[0]); // most recently updated
        // Prune stale duplicates silently
        drafts.slice(1).forEach((d) => deleteEmailDraft(dealId, d.id).catch(() => {}));
      })
      .catch(() => {});
    getEmailSignature().then(setSignature).catch(() => {});
    getReplyContext(dealId).then((ctx) => {
      setReplyContext(ctx);
      if (ctx.threadId) {
        setLoadingThread(true);
        getEmailThreads(dealId).then((data) => {
          const match = data.threads.find((t) => t.replyThreadId === ctx.threadId);
          if (match) setPriorThread(match);
        }).catch(() => {}).finally(() => setLoadingThread(false));
      }
    }).catch(() => {});
    getMeetingInfo(dealId).then(setMeetingInfo).catch(() => {});
    listDraftAttachments(dealId).then(setDraftAttachments).catch(() => {});
  }, [dealId]);

  // The attachment agent may finish on a different poll tick than the draft
  // agent — refresh attachments whenever a draft agent newly completes so the
  // composer picks up newly-arrived chips. Keyed on insight id to avoid
  // re-running on every render (new object reference from .find()).
  const completedInsightId = completedResult?.id ?? null;
  useEffect(() => {
    if (!completedInsightId) return;
    listDraftAttachments(dealId).then(setDraftAttachments).catch(() => {});
  }, [dealId, completedInsightId]);

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
      replyToThreadId: replyContext.threadId,
      replyToMessageId: replyContext.internetMessageId,
      status: "draft",
      attachments: null,
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
          signature={signature}
          isNextAction
          initialDraftAttachments={draftAttachments}
          onClose={() => setComposerOpen(false)}
          onSent={async () => {
            setComposerOpen(false);
            setEmailSent(initialDraft.subject ?? "Email");
            setSavedDraft(null);
            setDraftAttachments([]);
            // Mark just THIS category's next_action as actioned. The other
            // pending actions (e.g., a meeting_brief coexisting with a reply)
            // stay live — the user sent the reply, not resolved the meeting.
            const resolveCategory = categoryHint ?? completedResult?.triggerCategory ?? undefined;
            await resolveNextAction(dealId, "done", resolveCategory || undefined).catch(() => {});
            onEmailSent?.();
          }}
          onDraftSaved={(draft) => setSavedDraft(draft)}
          onDiscarded={() => {
            // Drop the saved draft so the agent's preview shows again.
            setSavedDraft(null);
            setComposerOpen(false);
          }}
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
            <Headphones className="h-3.5 w-3.5" />
            Contact Support
          </button>
        )}
      </div>
    );
  }

  // Agent still running
  if (hasPending) {
    const pendingResult = results.find((r) => r.status === "pending" || r.status === "running");
    const pendingCategory = pendingResult?.triggerCategory;
    const pendingLabel = pendingCategory === "followUp" ? "Preparing Follow-Up Draft"
      : pendingCategory === "reply" ? "Preparing Reply Draft"
      : pendingCategory === "meeting_brief" ? "Preparing Meeting Brief"
      : "Preparing First Response Email";
    const pendingDesc = pendingCategory === "followUp" ? "The AI agent is drafting a follow-up email based on the prior conversation."
      : pendingCategory === "reply" ? "The AI agent is drafting a reply based on the client's message."
      : pendingCategory === "meeting_brief" ? "The AI agent is preparing talking points and research for your upcoming meeting."
      : "The AI agent is researching the potential and drafting a First Response Email. This typically takes 20–40 seconds.";

    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-12">
        <div className="w-14 h-14 rounded-2xl bg-blue-50 flex items-center justify-center mb-4">
          <Bot className="h-6 w-6 text-blue-500 animate-pulse" />
        </div>
        <p className="text-sm font-semibold text-slate-700 mb-1">{pendingLabel}</p>
        <p className="text-xs text-slate-500 max-w-sm">{pendingDesc}</p>
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

  // Meeting brief — not an email draft, just meeting info + agent content + skip/done
  if (completedResult?.triggerCategory === "meeting_brief" && completedResult.content) {
    const mi = meetingInfo;
    const meetingLink = mi?.meetingLink || null;
    const formatMeetingTime = (iso: string | null) => {
      if (!iso) return "";
      const d = new Date(iso.endsWith("Z") ? iso : iso + "Z");
      return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    };

    return (
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="px-4 py-4 space-y-4">
          {/* Header — Skip/Done removed; both actions live on the Panel 2 queue card */}
          <div className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-blue-600" />
            <span className="text-xs font-semibold text-slate-700">Meeting Prep</span>
          </div>

          {/* Meeting details card */}
          <div className="rounded-lg border border-blue-200 bg-blue-50/50 overflow-hidden">
            <div className="px-3 py-2 bg-blue-100/50 border-b border-blue-200">
              <p className="text-xs font-semibold text-slate-900">{mi?.title || "Meeting"}</p>
            </div>
            <div className="px-3 py-2.5 space-y-2">
              {/* Time */}
              {mi?.startTime && (
                <div className="flex items-center gap-2 text-xs text-slate-700">
                  <Clock className="h-3 w-3 text-blue-400 shrink-0" />
                  <span>{formatMeetingTime(mi.startTime)}</span>
                  {mi.endTime && <span className="text-slate-400">→ {formatMeetingTime(mi.endTime)}</span>}
                </div>
              )}

              {/* Location / link */}
              {mi?.location && (
                <div className="flex items-start gap-2 text-xs text-slate-700">
                  {meetingLink ? <Video className="h-3 w-3 text-blue-400 shrink-0 mt-0.5" /> : <MapPin className="h-3 w-3 text-blue-400 shrink-0 mt-0.5" />}
                  <span>{mi.location}</span>
                </div>
              )}
              {meetingLink && (
                <div className="ml-5">
                  <a href={meetingLink} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-700 underline underline-offset-2">
                    <ExternalLink className="h-3 w-3" /> Join Meeting
                  </a>
                </div>
              )}

              {/* Participants */}
              {mi?.attendees && mi.attendees.length > 0 && (
                <div className="flex items-start gap-2 text-xs text-slate-700">
                  <Users className="h-3 w-3 text-blue-400 shrink-0 mt-0.5" />
                  <div className="flex flex-wrap gap-1">
                    {mi.attendees.map((email, i) => (
                      <span key={i} className="inline-block bg-white border border-blue-100 rounded-full px-2 py-0.5 text-[10px] text-slate-600">
                        {email}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Contact + Company from potential */}
              {detail?.contact?.name && (
                <div className="flex items-center gap-2 text-xs text-slate-600 pt-1 border-t border-blue-100">
                  <span className="font-medium">{detail.contact.name}</span>
                  {detail.contact.title && <span className="text-slate-400">· {detail.contact.title}</span>}
                  {detail.company?.name && <span className="text-slate-400">· {detail.company.name}</span>}
                </div>
              )}

              {/* Description */}
              {mi?.description && (
                <div className="pt-1 border-t border-blue-100">
                  <p className="text-[11px] text-slate-500 line-clamp-3">{mi.description.replace(/<[^>]*>/g, "")}</p>
                </div>
              )}
            </div>
          </div>

          {/* Agent content */}
          <div>
            <p className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider mb-2">AI Meeting Prep</p>
            <div className="rounded-lg border border-slate-200 p-4">
              {(() => {
                const brief = parseMeetingBrief(completedResult.content);
                if (!brief) {
                  // Fallback — LLM emitted something we couldn't parse, render as-is.
                  return <MarkdownBlock content={completedResult.content} compact />;
                }
                return (
                  <div className="space-y-4 text-xs text-slate-700">
                    {brief.oneLiner && (
                      <div>
                        <p className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider mb-1">Summary</p>
                        <p className="text-slate-700 leading-relaxed">{brief.oneLiner}</p>
                      </div>
                    )}
                    {brief.agenda && (
                      <div>
                        <p className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider mb-1">Agenda</p>
                        <p className="text-slate-700 leading-relaxed">{brief.agenda}</p>
                      </div>
                    )}
                    {brief.keyTalkingPoints.length > 0 && (
                      <div>
                        <p className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider mb-1">Key Talking Points</p>
                        <ul className="list-disc pl-4 space-y-1.5 marker:text-slate-400">
                          {brief.keyTalkingPoints.map((tp, i) => (
                            <li key={i} className="leading-relaxed">{tp}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {brief.questionsToAsk.length > 0 && (
                      <div>
                        <p className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider mb-1">Questions to Ask</p>
                        <ol className="list-decimal pl-4 space-y-1.5 marker:text-slate-400">
                          {brief.questionsToAsk.map((q, i) => (
                            <li key={i} className="leading-relaxed">{q}</li>
                          ))}
                        </ol>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (previewDraft) {
    const category = completedResult?.triggerCategory;
    const draftLabel = category === "followUp" ? "Follow-Up Draft"
      : category === "reply" ? "Reply Draft"
      : "First Response Draft";

    return (
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="px-4 py-4 space-y-4">
          {/* Draft preview card */}
          <div className="rounded-lg border border-slate-200 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <Mail className="h-3.5 w-3.5 text-slate-400" />
                <span className="text-xs font-semibold text-slate-600">{draftLabel} — Ready to Send</span>
                {savedDraft && (
                  <span className="text-[10px] font-medium text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-full px-1.5 py-0.5">
                    Saved
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                {/* Skip + Done both live on the Panel 2 queue card — removed from here */}
                {!readOnly && (
                  <button
                    onClick={handleOpenComposer}
                    className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-700 transition-colors shadow-sm"
                  >
                    <Mail className="h-3 w-3" />
                    Open in Composer
                  </button>
                )}
                {readOnly && (
                  <span className="text-[10px] text-slate-400 italic">Read-only — owned by {detail?.ownerName ?? "another user"}</span>
                )}
              </div>
            </div>

            <div className="px-4 py-3 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold text-slate-400 uppercase w-12 shrink-0">To</span>
                <span className="text-xs text-slate-700">{contactEmail || "—"}</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-[10px] font-semibold text-slate-400 uppercase w-12 shrink-0 pt-0.5">Subject</span>
                <span className="text-xs font-medium text-slate-800">{previewDraft.subject || "—"}</span>
              </div>
              {draftAttachments.length > 0 && (
                <div className="flex items-start gap-2">
                  <span className="text-[10px] font-semibold text-slate-400 uppercase w-12 shrink-0 pt-1">Files</span>
                  <div className="flex flex-wrap gap-1.5">
                    {draftAttachments.map((a) => {
                      const kb = Math.round((a.fileSize || 0) / 1024);
                      return (
                        <div key={a.id} className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs text-indigo-700">
                          <Paperclip className="h-3 w-3 text-indigo-400" />
                          <button
                            type="button"
                            onClick={() => { openDraftAttachment(dealId, a.id, a.contentType).catch(() => {}); }}
                            className="max-w-[200px] truncate underline-offset-2 hover:underline"
                            title={`Preview ${a.filename}`}
                          >
                            {a.filename}
                          </button>
                          {kb > 0 && <span className="text-indigo-400">{kb}KB</span>}
                          <button
                            type="button"
                            onClick={async () => {
                              setDraftAttachments((prev) => prev.filter((x) => x.id !== a.id));
                              try { await removeDraftAttachment(dealId, a.id); } catch { /* non-fatal */ }
                            }}
                            className="text-indigo-400 hover:text-red-500 transition-colors"
                            title="Remove"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="border-t border-slate-100 pt-3">
                <div
                  className="text-sm text-slate-700 leading-relaxed prose prose-sm max-w-none"
                  dangerouslySetInnerHTML={{ __html: previewDraft.body }}
                />
              </div>
            </div>
          </div>

          {/* Prior conversation — shown for follow-ups */}
          {loadingThread && (
            <div className="flex items-center gap-2 py-3 text-slate-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span className="text-xs">Loading prior conversation…</span>
            </div>
          )}
          {!loadingThread && priorThread && priorThread.messages.length > 0 && (
            <div>
              <p className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider mb-2">
                Prior Conversation ({priorThread.messageCount} {priorThread.messageCount === 1 ? "message" : "messages"})
              </p>
              <div className="rounded-lg border border-slate-200 overflow-hidden divide-y divide-slate-100">
                {[...priorThread.messages]
                  .sort((a, b) => {
                    const ta = a.sentTime ?? a.receivedTime ?? "";
                    const tb = b.sentTime ?? b.receivedTime ?? "";
                    return tb.localeCompare(ta);
                  })
                  .map((msg) => (
                    <PriorMessage key={msg.id} msg={msg} />
                  ))}
              </div>
            </div>
          )}
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
