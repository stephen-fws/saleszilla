import { useEffect, useState, useCallback } from "react";
import { Loader2, Pencil, Trash2, Mail, Plus, ChevronDown, Reply, Info, RefreshCw, Paperclip, Download } from "lucide-react";
import type { EmailDraft, SyncEmailThread, SyncEmailMessage, SyncEmailAttachment } from "@/types";
import { getEmailDrafts, deleteEmailDraft, getEmailSignature, getEmailThreads, downloadEmailAttachment } from "@/lib/api";
import { splitEmailList } from "@/lib/utils";
import EmailComposer from "./EmailComposer";

interface EmailsTabProps {
  dealId: string;
  contactEmail?: string | null;
  contactName?: string | null;
  /**
   * True when the viewing user is NOT the potential owner (e.g., a manager
   * looking at a reportee's deal). Hides Reply / Compose controls because
   * sending would use the viewer's MS mailbox instead of the owner's.
   */
  readOnly?: boolean;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function initials(email: string): string {
  const name = email.split("@")[0] || "?";
  const parts = name.split(/[._-]/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function friendlyName(email: string): string {
  const name = email.split("@")[0] || email;
  return name.split(/[._-]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function shortDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso.endsWith("Z") ? iso : iso + "Z");
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (isToday) return `Today, ${time}`;
  const isThisYear = d.getFullYear() === now.getFullYear();
  if (isThisYear) {
    const datePart = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return `${datePart}, ${time}`;
  }
  const datePart = d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return `${datePart}, ${time}`;
}

function fullDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso.endsWith("Z") ? iso : iso + "Z");
  return d.toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function bodyPreview(body: string | null, maxLen = 100): string {
  if (!body) return "No content";
  const plain = body.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  return plain.length > maxLen ? plain.slice(0, maxLen) + "…" : plain;
}

// ── Draft card ──────────────────────────────────────────────────────────────

function DraftCard({ draft, onEdit, onDelete }: {
  draft: EmailDraft;
  onEdit: (d: EmailDraft) => void;
  onDelete: (id: number) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  return (
    <div
      onClick={() => onEdit(draft)}
      className="group flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-amber-50/60 transition-colors border-b border-slate-100 last:border-b-0"
    >
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-100 text-amber-600 shrink-0">
        <Pencil className="h-3.5 w-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-slate-800 truncate">{draft.subject || "(No subject)"}</span>
          <span className="text-[10px] text-amber-600 font-medium shrink-0">Draft</span>
        </div>
        <p className="text-[11px] text-slate-500 truncate mt-0.5">To: {draft.toEmail || "—"}</p>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); setDeleting(true); onDelete(draft.id); }}
        disabled={deleting}
        className="p-1 rounded text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition shrink-0"
      >
        {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
      </button>
    </div>
  );
}


// ── Conversation view (Outlook reading-pane style) ──────────────────────────

function ConversationView({ thread, onReply, defaultCollapsed = false, dealId, readOnly = false }: {
  thread: SyncEmailThread;
  onReply: () => void;
  defaultCollapsed?: boolean;
  dealId: string;
  readOnly?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const lastMsg = thread.messages[thread.messages.length - 1];
  const ts = lastMsg?.sentTime || lastMsg?.receivedTime;

  return (
    <div>
      {/* Thread subject header — click to expand/collapse */}
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="w-full flex items-start gap-3 px-4 py-2.5 text-left hover:bg-slate-50 transition-colors"
      >
        <div className={`flex h-8 w-8 items-center justify-center rounded-full shrink-0 mt-0.5 text-[10px] font-bold ${
          lastMsg?.direction === "received" ? "bg-blue-100 text-blue-700" : "bg-emerald-100 text-emerald-700"
        }`}>
          {initials(lastMsg?.fromEmail || "")}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-xs font-semibold text-slate-800 truncate">{thread.subject}</span>
              {thread.messageCount > 1 && (
                <span className="text-[9px] bg-slate-200 text-slate-600 rounded-full px-1.5 py-0.5 font-semibold shrink-0">
                  {thread.messageCount}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-[10px] text-slate-400">{shortDate(ts)}</span>
              <ChevronDown className={`h-3 w-3 text-slate-400 transition-transform ${collapsed ? "-rotate-90" : ""}`} />
            </div>
          </div>
          {collapsed && (
            <p className="text-[10px] text-slate-400 truncate mt-0.5">{bodyPreview(lastMsg?.body, 100)}</p>
          )}
        </div>
      </button>

      {/* Expanded: message stack + reply prompt — indented to nest under the thread header */}
      {!collapsed && (
        <div className="ml-6 border-l-2 border-blue-100">
          {/* Flat thread info banner */}
          {thread.isFlat && (
            <div className="mx-3 mt-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
              <div className="flex items-start gap-2">
                <Info className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-[11px] font-medium text-amber-800">Older conversation — limited threading</p>
                  <p className="text-[10px] text-amber-700 mt-0.5 leading-relaxed">
                    This conversation was captured before thread tracking was enabled. Replying from here will start a new email thread.
                    To keep the original thread intact, reply directly from Outlook — the next sync will restore full conversation threading.
                  </p>
                </div>
              </div>
            </div>
          )}
          {/* Reply prompt at the top — sits just above the most recent
              message (we render newest-first below). */}
          {!readOnly && (
            <div className="px-4 pt-3 pb-2">
              <button
                onClick={onReply}
                className="w-full flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500 hover:bg-white hover:border-blue-300 hover:text-blue-600 transition-colors"
              >
                <Reply className="h-3.5 w-3.5" />
                Reply to this thread…
              </button>
            </div>
          )}
          <div>
            {/* Newest-first within the thread. isLast means "most recent" — drives the
                default-expanded state on MessageBubble, so after desc sort that's index 0. */}
            {[...thread.messages]
              .sort((a, b) => {
                const ta = a.sentTime ?? a.receivedTime ?? "";
                const tb = b.sentTime ?? b.receivedTime ?? "";
                return tb.localeCompare(ta);
              })
              .map((msg, i) => (
                <MessageBubble key={msg.id} msg={msg} isLast={i === 0} dealId={dealId} />
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AttachmentChip({ att, graphMessageId, dealId }: {
  att: SyncEmailAttachment; graphMessageId: string | null; dealId: string;
}) {
  const [downloading, setDownloading] = useState(false);
  const canDownload = !!(graphMessageId && att.id);
  const sizeLabel = att.size > 0
    ? att.size >= 1048576 ? `${(att.size / 1048576).toFixed(1)}MB` : `${Math.round(att.size / 1024)}KB`
    : "";

  async function handleClick() {
    if (!canDownload || downloading) return;
    setDownloading(true);
    try {
      await downloadEmailAttachment(dealId, graphMessageId!, att.id, att.name);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <button
      onClick={canDownload ? handleClick : undefined}
      disabled={downloading}
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] transition-colors ${
        downloading
          ? "border-blue-200 bg-blue-50 text-blue-600"
          : canDownload
            ? "border-slate-200 bg-slate-50 text-slate-600 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-700 cursor-pointer"
            : "border-slate-200 bg-slate-50 text-slate-600"
      }`}
      title={canDownload ? `Download ${att.name}` : att.name}
    >
      {downloading
        ? <Loader2 className="h-3 w-3 animate-spin" />
        : <Paperclip className="h-3 w-3 text-slate-400" />
      }
      {att.name}
      {sizeLabel && <span className="text-slate-400 ml-0.5">({sizeLabel})</span>}
      {canDownload && !downloading && <Download className="h-3 w-3 text-slate-400" />}
    </button>
  );
}

function AttachmentList({ attachments, graphMessageId, dealId }: {
  attachments: SyncEmailAttachment[]; graphMessageId: string | null; dealId: string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5 pt-1">
      {attachments.map((att, i) => (
        <AttachmentChip key={i} att={att} graphMessageId={graphMessageId} dealId={dealId} />
      ))}
    </div>
  );
}

function MessageBubble({ msg, isLast, dealId }: { msg: SyncEmailMessage; isLast: boolean; dealId: string }) {
  const [collapsed, setCollapsed] = useState(!isLast);
  const isSent = msg.direction === "sent";
  const ts = msg.sentTime || msg.receivedTime;
  const senderEmail = msg.fromEmail;

  return (
    <div className={`border-b border-slate-100 last:border-b-0 ${collapsed ? "" : "bg-white"}`}>
      {/* Message header — always visible, click to expand/collapse */}
      <button
        onClick={() => setCollapsed((v) => !v)}
        className={`w-full flex items-start gap-3 px-4 py-3 text-left transition-colors ${collapsed ? "hover:bg-slate-50" : ""}`}
      >
        <div className={`flex h-8 w-8 items-center justify-center rounded-full shrink-0 text-[10px] font-bold ${
          isSent ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700"
        }`}>
          {initials(senderEmail)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-xs font-semibold text-slate-800 truncate">{friendlyName(senderEmail)}</span>
              {isSent && (
                <span className="text-[9px] bg-emerald-50 text-emerald-600 border border-emerald-200 rounded-full px-1.5 py-0.5 font-medium shrink-0">Sent</span>
              )}
              {msg.hasAttachments && (
                <Paperclip className="h-3 w-3 text-slate-400 shrink-0" />
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {!collapsed && (
                <ChevronDown className="h-3 w-3 text-slate-400" />
              )}
              <span className="text-[10px] text-slate-400">{shortDate(ts)}</span>
            </div>
          </div>
          {collapsed ? (
            <p className="text-[10px] text-slate-400 truncate mt-0.5">{bodyPreview(msg.body, 100)}</p>
          ) : (
            // Outlook-style header: To / CC / BCC each on their own line when expanded.
            // Only show CC/BCC when populated. BCC is only present for user-sent items.
            <div className="text-[10px] text-slate-500 mt-0.5 space-y-0.5">
              <div>
                <span className="font-semibold text-slate-600">To:</span> {msg.toEmail}
                <span className="text-slate-400 ml-2">{fullDate(ts)}</span>
              </div>
              {msg.cc && (
                <div><span className="font-semibold text-slate-600">CC:</span> {msg.cc}</div>
              )}
              {msg.bcc && (
                <div><span className="font-semibold text-slate-600">BCC:</span> {msg.bcc}</div>
              )}
            </div>
          )}
        </div>
      </button>

      {/* Message body + attachments — visible when expanded */}
      {!collapsed && (
        <div className="px-4 pb-4 pl-[60px] space-y-2">
          {msg.body && (
            <div
              className="text-[13px] text-slate-700 leading-relaxed prose prose-sm max-w-none"
              dangerouslySetInnerHTML={{ __html: msg.body }}
            />
          )}
          {msg.attachments.length > 0 && (
            <AttachmentList attachments={msg.attachments} graphMessageId={msg.graphMessageId} dealId={dealId} />
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export default function EmailsTab({ dealId, contactEmail, contactName, readOnly = false }: EmailsTabProps) {
  const [drafts, setDrafts] = useState<EmailDraft[]>([]);
  const [threads, setThreads] = useState<SyncEmailThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [composing, setComposing] = useState(false);
  const [editingDraft, setEditingDraft] = useState<EmailDraft | null>(null);
  const [signature, setSignature] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [draftData, threadData] = await Promise.all([
        getEmailDrafts(dealId),
        getEmailThreads(dealId),
      ]);
      setDrafts(draftData);
      setThreads(threadData.threads);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    loadData();
    getEmailSignature().then(setSignature).catch(() => {});
  }, [loadData]);

  async function handleRefresh() {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }

  function handleCompose() { setEditingDraft(null); setComposing(true); }

  function handleReply(thread: SyncEmailThread) {
    const lastMsg = thread.messages[thread.messages.length - 1];
    // Sync table stores To/Cc as ";"-separated. Split so each address lands
    // in its own tag in the composer, in the right To/Cc field.
    // - Inbound: reply To = sender; carry over original CC.
    // - Outbound: continue to the original recipients (To + CC).
    const toList = lastMsg?.direction === "received"
      ? (lastMsg.fromEmail ? [lastMsg.fromEmail] : [])
      : splitEmailList(lastMsg?.toEmail);
    const ccList = splitEmailList(lastMsg?.cc);
    const toEmail = toList.length > 0 ? toList.join("; ") : (contactEmail || "");
    const replyDraft: EmailDraft = {
      id: 0, potentialId: dealId,
      toEmail, toName: null,
      ccEmails: ccList.length > 0 ? ccList : null, bccEmails: null,
      subject: thread.subject.startsWith("RE:") ? thread.subject : `RE: ${thread.subject}`,
      body: "",
      replyToThreadId: thread.replyThreadId, replyToMessageId: thread.replyToMessageId,
      status: "draft", attachments: null, createdTime: null, updatedTime: null,
    };
    setEditingDraft(replyDraft);
    setComposing(true);
  }

  function handleEditDraft(draft: EmailDraft) { setEditingDraft(draft); setComposing(true); }

  async function handleDeleteDraft(id: number) {
    await deleteEmailDraft(dealId, id);
    setDrafts((prev) => prev.filter((d) => d.id !== id));
  }

  function handleDraftSaved(draft: EmailDraft) {
    setDrafts((prev) => {
      const idx = prev.findIndex((d) => d.id === draft.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = draft; return next; }
      return [draft, ...prev];
    });
  }

  function handleSent() {
    if (editingDraft) setDrafts((prev) => prev.filter((d) => d.id !== editingDraft.id));
    setComposing(false); setEditingDraft(null); loadData();
  }

  if (composing) {
    return (
      <EmailComposer
        dealId={dealId} initialDraft={editingDraft}
        contactEmail={contactEmail} contactName={contactName} signature={signature}
        onClose={() => { setComposing(false); setEditingDraft(null); }}
        onSent={handleSent} onDraftSaved={handleDraftSaved}
        onDiscarded={(draftId) => {
          setDrafts((prev) => prev.filter((d) => d.id !== draftId));
        }}
      />
    );
  }


  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 shrink-0 bg-white">
        <span className="text-xs font-semibold text-slate-600">
          Emails
          {threads.length > 0 && (
            <span className="font-normal text-slate-400 ml-1">
              · {threads.reduce((n, t) => n + t.messageCount, 0)} in {threads.length} {threads.length === 1 ? "thread" : "threads"}
            </span>
          )}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleRefresh}
            disabled={refreshing || loading}
            title="Refresh emails"
            className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500 hover:text-slate-700 hover:bg-slate-50 disabled:opacity-40 transition-colors"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          </button>
          {!readOnly && (
            <button
              onClick={handleCompose}
              className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-700 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              New
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        </div>
      ) : threads.length === 0 && drafts.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
          <Mail className="h-8 w-8 text-slate-300 mb-2" />
          <p className="text-xs font-medium text-slate-500">No emails yet</p>
          <p className="text-[11px] text-slate-400 mt-0.5">Send the first email to get started.</p>
        </div>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Drafts — hidden entirely in read-only mode (drafts belong to the owner, not the manager viewing) */}
          {!readOnly && drafts.length > 0 && (
            <div className="shrink-0 border-b border-slate-200 bg-amber-50/30">
              <div className="px-3 py-1.5">
                <span className="text-[10px] uppercase font-semibold text-amber-600 tracking-wider">
                  Drafts ({drafts.length})
                </span>
              </div>
              <div className="divide-y divide-amber-100/60">
                {drafts.map((d) => (
                  <DraftCard key={d.id} draft={d} onEdit={handleEditDraft} onDelete={handleDeleteDraft} />
                ))}
              </div>
            </div>
          )}

          {/* All threads shown inline — each as a collapsible conversation */}
          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {threads.map((t) => (
              <div key={t.threadKey} className="border-b border-slate-200 last:border-b-0">
                <ConversationView
                  thread={t}
                  onReply={() => handleReply(t)}
                  defaultCollapsed={threads.length > 1}
                  dealId={dealId}
                  readOnly={readOnly}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
