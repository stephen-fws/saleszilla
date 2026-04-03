import { useEffect, useState, useCallback } from "react";
import { Loader2, Pencil, Trash2, Mail, Plus } from "lucide-react";
import type { EmailDraft } from "@/types";
import { getEmailDrafts, deleteEmailDraft, getEmailSignature } from "@/lib/api";
import EmailComposer from "./EmailComposer";

interface EmailsTabProps {
  dealId: string;
  contactEmail?: string | null;
  contactName?: string | null;
}

function DraftCard({
  draft,
  onEdit,
  onDelete,
}: {
  draft: EmailDraft;
  onEdit: (d: EmailDraft) => void;
  onDelete: (id: number) => void;
}) {
  const [deleting, setDeleting] = useState(false);

  const preview = draft.body
    ? draft.body.replace(/<[^>]*>/g, "").slice(0, 80) + (draft.body.length > 80 ? "…" : "")
    : "No content";

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    setDeleting(true);
    try { await onDelete(draft.id); } finally { setDeleting(false); }
  }

  return (
    <div
      onClick={() => onEdit(draft)}
      className="group rounded-lg border border-slate-200 p-3 cursor-pointer hover:border-blue-300 hover:bg-blue-50/30 transition-colors"
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <p className="text-xs font-semibold text-slate-700 truncate flex-1">
          {draft.subject || "(No subject)"}
        </p>
        <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(draft); }}
            className="p-1 rounded text-slate-400 hover:text-blue-600 transition-colors"
            title="Edit"
          >
            <Pencil className="h-3 w-3" />
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="p-1 rounded text-slate-400 hover:text-red-500 transition-colors"
            title="Delete"
          >
            {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
          </button>
        </div>
      </div>
      <p className="text-[11px] text-slate-500 truncate">
        To: {draft.toEmail || "—"}
        {draft.ccEmails?.length ? ` · CC: ${draft.ccEmails.join(", ")}` : ""}
      </p>
      <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-2">{preview}</p>
      {draft.updatedTime && (
        <p className="text-[10px] text-slate-400 mt-1">
          Saved {new Date(draft.updatedTime.endsWith("Z") ? draft.updatedTime : draft.updatedTime + "Z")
            .toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
        </p>
      )}
    </div>
  );
}

export default function EmailsTab({ dealId, contactEmail, contactName }: EmailsTabProps) {
  const [drafts, setDrafts] = useState<EmailDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [composing, setComposing] = useState(false);
  const [editingDraft, setEditingDraft] = useState<EmailDraft | null>(null);
  const [signature, setSignature] = useState<string | null>(null);

  const loadDrafts = useCallback(async () => {
    try {
      const data = await getEmailDrafts(dealId);
      setDrafts(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    loadDrafts();
    getEmailSignature().then(setSignature).catch(() => {});
  }, [loadDrafts]);

  function handleCompose() {
    setEditingDraft(null);
    setComposing(true);
  }

  function handleEditDraft(draft: EmailDraft) {
    setEditingDraft(draft);
    setComposing(true);
  }

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
    if (editingDraft) {
      setDrafts((prev) => prev.filter((d) => d.id !== editingDraft.id));
    }
    setComposing(false);
    setEditingDraft(null);
  }

  // ── Composer view ──
  if (composing) {
    return (
      <EmailComposer
        dealId={dealId}
        initialDraft={editingDraft}
        contactEmail={contactEmail}
        contactName={contactName}
        signature={signature}
        onClose={() => { setComposing(false); setEditingDraft(null); }}
        onSent={handleSent}
        onDraftSaved={handleDraftSaved}
      />
    );
  }

  // ── List view ──
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 shrink-0">
        <span className="text-xs font-semibold text-slate-600">Emails</span>
        <button
          onClick={handleCompose}
          className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          Compose
        </button>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-3 space-y-4">
        {/* Drafts */}
        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          </div>
        ) : drafts.length > 0 ? (
          <div>
            <p className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider mb-2">Saved Drafts</p>
            <div className="space-y-2">
              {drafts.map((d) => (
                <DraftCard key={d.id} draft={d} onEdit={handleEditDraft} onDelete={handleDeleteDraft} />
              ))}
            </div>
          </div>
        ) : null}

        {/* Thread placeholder */}
        <div>
          <p className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider mb-2">Email Thread</p>
          <div className="rounded-lg border border-dashed border-slate-200 p-6 flex flex-col items-center justify-center text-center">
            <Mail className="h-5 w-5 text-slate-300 mb-2" />
            <p className="text-xs text-slate-400">Email thread will appear here</p>
          </div>
        </div>
      </div>
    </div>
  );
}
