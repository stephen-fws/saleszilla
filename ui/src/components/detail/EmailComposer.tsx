import { useState, useRef, useCallback, useEffect } from "react";
import {
  X, Send, Save, Paperclip, Loader2, Check, Trash2,
  Bold, Italic, Underline as UnderlineIcon, Link, List, ListOrdered,
  Quote, Undo2, Redo2, Unlink,
} from "lucide-react";
import { useEditor, EditorContent } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import UnderlineExt from "@tiptap/extension-underline";
import LinkExt from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import TextAlign from "@tiptap/extension-text-align";

// ── Custom line-height extension ──────────────────────────────────────────────

const LINE_HEIGHTS = ["1", "1.2", "1.5", "1.8", "2", "2.5"];
const LINE_HEIGHT_LABELS: Record<string, string> = {
  "1": "Single", "1.2": "1.2", "1.5": "1.5", "1.8": "1.8", "2": "Double", "2.5": "2.5",
};

const LineHeight = Extension.create({
  name: "lineHeight",
  addGlobalAttributes() {
    return [{
      types: ["paragraph", "heading"],
      attributes: {
        lineHeight: {
          default: null,
          parseHTML: (el) => el.style.lineHeight || null,
          renderHTML: (attrs) => attrs.lineHeight ? { style: `line-height: ${attrs.lineHeight}` } : {},
        },
      },
    }];
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addCommands(): any {
    return {
      setLineHeight: (lh: string) => ({ commands }: any) =>
        commands.updateAttributes("paragraph", { lineHeight: lh }),
      unsetLineHeight: () => ({ commands }: any) =>
        commands.resetAttributes("paragraph", "lineHeight"),
    };
  },
});
import type { EmailDraft, EmailAttachment, DraftAttachment } from "@/types";
import { createEmailDraft, updateEmailDraft, sendEmail, removeDraftAttachment, openDraftAttachment, deleteEmailDraft } from "@/lib/api";
import { validateAttachmentFile, MAX_ATTACHMENT_TOTAL_BYTES, formatBytes } from "@/lib/attachments";
import { splitEmailList } from "@/lib/utils";
import { composerDirty } from "@/lib/composerDirty";

// ── Tag input for To/CC/BCC ───────────────────────────────────────────────────

function EmailInput({
  label, value, onChange, placeholder,
}: {
  label: string;
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  const [input, setInput] = useState("");

  function addEmail(raw: string) {
    const trimmed = raw.trim().replace(/,+$/, "");
    if (trimmed && !value.includes(trimmed)) onChange([...value, trimmed]);
    setInput("");
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === "," || e.key === "Tab") {
      e.preventDefault();
      addEmail(input);
    }
    if (e.key === "Backspace" && !input && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div className="flex items-start gap-2 px-3 py-1.5 border-b border-slate-100">
      <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider w-8 shrink-0 pt-1">{label}</span>
      <div className="flex flex-wrap gap-1 flex-1 min-w-0">
        {value.map((email) => (
          <span key={email} className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
            {email}
            <button type="button" onClick={() => onChange(value.filter((e) => e !== email))}>
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKey}
          onBlur={() => { if (input) addEmail(input); }}
          placeholder={value.length === 0 ? placeholder : ""}
          className="flex-1 min-w-[120px] text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none bg-transparent py-0.5"
        />
      </div>
    </div>
  );
}

// ── Tiptap rich text editor ───────────────────────────────────────────────────

function ToolBtn({
  onClick, active, title, children,
}: {
  onClick: () => void;
  active?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      className={`p-1.5 rounded transition-colors ${
        active
          ? "bg-slate-200 text-slate-900"
          : "text-slate-500 hover:bg-slate-200 hover:text-slate-800"
      }`}
    >
      {children}
    </button>
  );
}

export function RichEditor({
  initialValue,
  onChange,
  placeholder,
}: {
  initialValue: string;
  onChange: (html: string) => void;
  placeholder?: string;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      UnderlineExt,
      LinkExt.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({ placeholder: placeholder ?? "Write your email…" }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      LineHeight,
    ],
    content: initialValue,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: {
        class: "rich-editor prose-email focus:outline-none min-h-[140px] px-3 py-2 text-sm text-slate-900",
      },
    },
  });

  const setLink = useCallback(() => {
    if (!editor) return;
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Enter URL:", prev ?? "https://");
    if (url === null) return;
    if (url === "") { editor.chain().focus().unsetLink().run(); return; }
    editor.chain().focus().setLink({ href: url }).run();
  }, [editor]);

  if (!editor) return null;

  const sep = <div className="w-px h-4 bg-slate-200 mx-0.5" />;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 px-2 py-1 border-b border-slate-100 bg-slate-50">
        <ToolBtn title="Bold (Ctrl+B)" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold className="h-3.5 w-3.5" />
        </ToolBtn>
        <ToolBtn title="Italic (Ctrl+I)" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic className="h-3.5 w-3.5" />
        </ToolBtn>
        <ToolBtn title="Underline (Ctrl+U)" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}>
          <UnderlineIcon className="h-3.5 w-3.5" />
        </ToolBtn>

        {sep}

        <ToolBtn title="Bullet list" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List className="h-3.5 w-3.5" />
        </ToolBtn>
        <ToolBtn title="Numbered list" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListOrdered className="h-3.5 w-3.5" />
        </ToolBtn>
        <ToolBtn title="Blockquote" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
          <Quote className="h-3.5 w-3.5" />
        </ToolBtn>

        {sep}

        <ToolBtn title="Insert / edit link" active={editor.isActive("link")} onClick={setLink}>
          <Link className="h-3.5 w-3.5" />
        </ToolBtn>
        {editor.isActive("link") && (
          <ToolBtn title="Remove link" onClick={() => editor.chain().focus().unsetLink().run()}>
            <Unlink className="h-3.5 w-3.5" />
          </ToolBtn>
        )}

        {sep}

        <ToolBtn title="Undo (Ctrl+Z)" onClick={() => editor.chain().focus().undo().run()}>
          <Undo2 className="h-3.5 w-3.5" />
        </ToolBtn>
        <ToolBtn title="Redo (Ctrl+Y)" onClick={() => editor.chain().focus().redo().run()}>
          <Redo2 className="h-3.5 w-3.5" />
        </ToolBtn>

        {sep}

        {/* Line spacing */}
        <select
          title="Line spacing"
          value={editor.getAttributes("paragraph").lineHeight ?? ""}
          onChange={(e) => {
            const val = e.target.value;
            if (val) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (editor.chain().focus() as any).setLineHeight(val).run();
            } else {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (editor.chain().focus() as any).unsetLineHeight().run();
            }
          }}
          className="text-[11px] text-slate-600 bg-transparent border border-slate-200 rounded px-1.5 py-0.5 hover:border-slate-300 focus:outline-none cursor-pointer"
        >
          <option value="">Spacing</option>
          {LINE_HEIGHTS.map((lh) => (
            <option key={lh} value={lh}>{LINE_HEIGHT_LABELS[lh]}</option>
          ))}
        </select>
      </div>

      {/* Editor content */}
      <div className="flex-1 overflow-y-auto">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

// ── Attachment chip ───────────────────────────────────────────────────────────

function AttachChip({ file, onRemove }: { file: EmailAttachment; onRemove: () => void }) {
  const kb = Math.round(file.sizeBytes / 1024);
  return (
    <div className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700">
      <Paperclip className="h-3 w-3 text-slate-400" />
      <span className="max-w-[120px] truncate">{file.name}</span>
      <span className="text-slate-400">{kb}KB</span>
      <button type="button" onClick={onRemove} className="text-slate-400 hover:text-red-500 transition-colors">
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

// Agent-generated attachment — rendered with a subtle indigo accent so the user
// can tell it came from the system vs. files they attached themselves.
// Filename is clickable → opens the HTML in a new tab for preview.
function DraftAttachChip({ dealId, file, onRemove }: { dealId: string; file: DraftAttachment; onRemove: () => void }) {
  const kb = Math.round((file.fileSize || 0) / 1024);
  return (
    <div className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs text-indigo-700">
      <Paperclip className="h-3 w-3 text-indigo-400" />
      <button
        type="button"
        onClick={() => { openDraftAttachment(dealId, file.id, file.contentType).catch(() => {}); }}
        className="max-w-[200px] truncate underline-offset-2 hover:underline"
        title={`Preview ${file.filename}`}
      >
        {file.filename}
      </button>
      {kb > 0 && <span className="text-indigo-400">{kb}KB</span>}
      <button type="button" onClick={onRemove} className="text-indigo-400 hover:text-red-500 transition-colors" title="Remove">
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

// ── Main composer ─────────────────────────────────────────────────────────────

interface EmailComposerProps {
  dealId: string;
  initialDraft?: EmailDraft | null;
  contactEmail?: string | null;
  contactName?: string | null;
  signature?: string | null;
  isNextAction?: boolean;
  initialDraftAttachments?: DraftAttachment[];
  onClose: () => void;
  onSent: () => void;
  onDraftSaved: (draft: EmailDraft) => void;
  // Fired after the user discards a saved draft. Parent should drop the draft
  // from its local state (EmailsTab list, NextActionTab savedDraft, etc.).
  onDiscarded?: (draftId: number) => void;
}

export default function EmailComposer({
  dealId, initialDraft, contactEmail, contactName, signature,
  isNextAction = false,
  initialDraftAttachments = [],
  onClose, onSent, onDraftSaved, onDiscarded,
}: EmailComposerProps) {
  // id=0 is the "not yet persisted" sentinel from agent-generated drafts
  const [draftId, setDraftId] = useState<number | null>(
    initialDraft?.id ? initialDraft.id : null
  );
  const [to, setTo] = useState<string[]>(
    // initialDraft.toEmail may be ";"-separated (sync-table rows store
    // multi-recipient lists that way) — split into individual tags.
    initialDraft?.toEmail
      ? splitEmailList(initialDraft.toEmail)
      : contactEmail
      ? [contactEmail]
      : []
  );
  const [cc, setCc] = useState<string[]>(initialDraft?.ccEmails ?? []);
  const [bcc, setBcc] = useState<string[]>(initialDraft?.bccEmails ?? []);
  const [subject, setSubject] = useState(initialDraft?.subject ?? "");
  // Body starts with the signature appended (if available and not already present)
  // so the user can see and edit it directly inside the editor.
  const computeInitialBody = (): string => {
    const raw = initialDraft?.body ?? "";
    if (!signature) return raw;
    // Avoid double-adding when the draft was already saved with a signature
    if (raw.includes("-- <br/>") || raw.includes("-- <br />") || raw.includes("-- <br>")) return raw;
    const sigHtml = `<br/><br/>-- <br/>${signature.replace(/\n/g, "<br/>")}`;
    return raw + sigHtml;
  };
  const [body, setBody] = useState(computeInitialBody);

  // Late-arriving signature — the parent fetches /me/email-signature async,
  // so it can resolve AFTER this component has mounted. If `signature` prop
  // transitions from null/empty to a value AND the current body doesn't
  // already include a signature delimiter, append it now. Same idempotency
  // guard as computeInitialBody.
  useEffect(() => {
    if (!signature) return;
    setBody((current) => {
      if (
        current.includes("-- <br/>") ||
        current.includes("-- <br />") ||
        current.includes("-- <br>")
      ) {
        return current;
      }
      const sigHtml = `<br/><br/>-- <br/>${signature.replace(/\n/g, "<br/>")}`;
      return current + sigHtml;
    });
    // Only rerun when signature itself changes, not on body edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
  // Seed manual attachments from the loaded draft so reopening a saved draft
  // restores the files the user had attached. Drafts created from agent
  // content (no persisted attachments) start empty.
  const [attachments, setAttachments] = useState<EmailAttachment[]>(initialDraft?.attachments ?? []);
  const [draftAttachments, setDraftAttachments] = useState<DraftAttachment[]>(initialDraftAttachments);
  const [showCc, setShowCc] = useState((initialDraft?.ccEmails?.length ?? 0) > 0);
  const [showBcc, setShowBcc] = useState((initialDraft?.bccEmails?.length ?? 0) > 0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Dirty-state tracking ────────────────────────────────────────────────
  // Snapshot the initial values at mount so we can detect any user-typed
  // change. Refs are updated on save so "saved" state == "clean" again.
  const initialRef = useRef({
    body,
    subject,
    to: to.join("|"),
    cc: cc.join("|"),
    bcc: bcc.join("|"),
    attachmentNames: attachments.map((a) => a.name).join("|"),
  });
  const isDirty =
    body !== initialRef.current.body ||
    subject !== initialRef.current.subject ||
    to.join("|") !== initialRef.current.to ||
    cc.join("|") !== initialRef.current.cc ||
    bcc.join("|") !== initialRef.current.bcc ||
    attachments.map((a) => a.name).join("|") !== initialRef.current.attachmentNames;

  useEffect(() => {
    composerDirty.set(isDirty);
  }, [isDirty]);

  useEffect(() => {
    // Always clear on unmount — once the composer is gone, there's nothing
    // unsaved any more (either the user committed via the prompt or we lost
    // the data, but the singleton must not leak across composer sessions).
    return () => composerDirty.set(false);
  }, []);

  // The editor holds the entire email content (including signature). Send/save
  // use `body` as-is — no post-hoc signature appending.
  function getFullBody() {
    return body;
  }

  function markAsSaved() {
    initialRef.current = {
      body,
      subject,
      to: to.join("|"),
      cc: cc.join("|"),
      bcc: bcc.join("|"),
      attachmentNames: attachments.map((a) => a.name).join("|"),
    };
    composerDirty.set(false);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    // Reject Outlook-blocked extensions up front — sending them via Graph
    // succeeds but the recipient's server strips the attachment, leaving the
    // UI stuck on "Sending…" with no actionable error.
    const allowed: File[] = [];
    const rejected: string[] = [];
    // Track running total across already-attached files + ones we're about to
    // accept in this batch, so a multi-file pick that crosses 25 MB stops
    // adding instead of silently letting Graph fail.
    let runningTotal =
      attachments.reduce((sum, a) => sum + (a.sizeBytes || 0), 0) +
      draftAttachments.reduce((sum, a) => sum + (a.fileSize || 0), 0);
    for (const file of files) {
      const reason = validateAttachmentFile(file);
      if (reason) { rejected.push(reason); continue; }
      if (runningTotal + file.size > MAX_ATTACHMENT_TOTAL_BYTES) {
        rejected.push(
          `${file.name} (${formatBytes(file.size)}) — would exceed Outlook's ${formatBytes(MAX_ATTACHMENT_TOTAL_BYTES)} attachment limit.`,
        );
        continue;
      }
      runningTotal += file.size;
      allowed.push(file);
    }
    if (rejected.length) {
      setError(rejected.join(" "));
    } else {
      setError(null);
    }
    allowed.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(",")[1];
        setAttachments((prev) => [...prev, {
          name: file.name,
          contentType: file.type || "application/octet-stream",
          contentBytes: base64,
          sizeBytes: file.size,
        }]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = "";
  }

  async function handleSaveDraft() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const payload = {
        toEmail: to[0] ?? null,
        toName: contactName ?? null,
        ccEmails: cc.length ? cc : null,
        bccEmails: bcc.length ? bcc : null,
        subject: subject || null,
        body: body || null,
        // Always send the full current attachment list — server treats this
        // as an overwrite, so removals carry through.
        attachments: attachments,
      };
      if (draftId) {
        const updated = await updateEmailDraft(dealId, draftId, payload);
        onDraftSaved(updated);
      } else {
        const created = await createEmailDraft(dealId, payload, isNextAction);
        setDraftId(created.id);
        onDraftSaved(created);
      }
      markAsSaved();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      console.error("[EmailComposer] save draft failed:", err);
      setError("Failed to save draft");
    } finally {
      setSaving(false);
    }
  }

  async function handleDiscard() {
    const persistedId = draftId;
    const hasContent = !!(subject.trim() || body.trim() || attachments.length);
    if (persistedId || hasContent) {
      const ok = window.confirm(
        persistedId
          ? "Discard this draft? This will permanently delete it."
          : "Discard your changes?"
      );
      if (!ok) return;
    }
    setDiscarding(true);
    setError(null);
    try {
      if (persistedId) {
        await deleteEmailDraft(dealId, persistedId);
        onDiscarded?.(persistedId);
      }
      onClose();
    } catch {
      setError("Failed to discard draft.");
    } finally {
      setDiscarding(false);
    }
  }

  async function handleSend() {
    if (!to.length) { setError("Please add at least one recipient"); return; }
    if (!subject.trim()) { setError("Subject is required"); return; }
    const totalBytes =
      attachments.reduce((sum, a) => sum + (a.sizeBytes || 0), 0) +
      draftAttachments.reduce((sum, a) => sum + (a.fileSize || 0), 0);
    if (totalBytes > MAX_ATTACHMENT_TOTAL_BYTES) {
      setError(
        `Attachments total ${formatBytes(totalBytes)} — exceeds Outlook's ${formatBytes(MAX_ATTACHMENT_TOTAL_BYTES)} limit. Remove some files and try again.`,
      );
      return;
    }
    setSending(true);
    setError(null);
    try {
      await sendEmail(dealId, {
        toEmail: to[0],
        toName: contactName ?? undefined,
        subject,
        body: getFullBody(),
        cc: cc.length ? cc : undefined,
        bcc: bcc.length ? bcc : undefined,
        draftId: draftId ?? undefined,
        attachments: attachments.length ? attachments : undefined,
        draftAttachmentIds: draftAttachments.length ? draftAttachments.map(a => a.id) : undefined,
        threadId: initialDraft?.replyToThreadId ?? undefined,
        replyToMessageId: initialDraft?.replyToMessageId ?? undefined,
      });
      onSent();
    } catch {
      setError("Failed to send email. Check your MS connection.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-200 bg-slate-50 shrink-0">
        <span className="text-sm font-semibold text-slate-800">
          {initialDraft?.replyToThreadId ? "Reply" : "New Email"}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={handleSaveDraft}
            disabled={saving}
            title="Save draft"
            className={`p-1.5 rounded transition-colors ${saved ? "text-emerald-500" : "text-slate-400 hover:text-slate-600 hover:bg-slate-200"}`}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
          </button>
          <button onClick={onClose} title="Close" className="p-1.5 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Recipients */}
      <div className="shrink-0 border-b border-slate-200">
        <EmailInput label="To" value={to} onChange={setTo} placeholder={`${contactName ?? "recipient"}@example.com`} />

        {showCc && <EmailInput label="CC" value={cc} onChange={setCc} placeholder="cc@example.com" />}
        {showBcc && <EmailInput label="BCC" value={bcc} onChange={setBcc} placeholder="bcc@example.com" />}

        <div className="flex items-center gap-2 px-3 py-1">
          {!showCc && (
            <button type="button" onClick={() => setShowCc(true)} className="text-[11px] text-blue-500 hover:text-blue-700">+ CC</button>
          )}
          {!showBcc && (
            <button type="button" onClick={() => setShowBcc(true)} className="text-[11px] text-blue-500 hover:text-blue-700">+ BCC</button>
          )}
        </div>

        {/* Subject */}
        <div className="flex items-center gap-2 px-3 py-1.5 border-t border-slate-100">
          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider w-12 shrink-0">Subject</span>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject line"
            className="flex-1 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none bg-transparent"
          />
        </div>
      </div>

      {/* Body — signature is part of the editable content, inserted at mount.
          The key includes whether a signature is present so that a late-
          arriving signature (parent fetched it async after this composer
          mounted) forces a RichEditor remount with the updated body — TipTap
          only reads `content` once on init, so without this the editor would
          keep showing the pre-signature body. */}
      <div className="flex-1 min-h-0 flex flex-col">
        <RichEditor
          key={signature ? "with-signature" : "no-signature"}
          initialValue={body}
          onChange={setBody}
          placeholder="Write your email…"
        />
      </div>

      {/* Attachments — agent-generated draft attachments render first, then manual */}
      {(draftAttachments.length > 0 || attachments.length > 0) && (
        <div className="shrink-0 flex flex-wrap gap-1.5 px-3 py-2 border-t border-slate-100">
          {draftAttachments.map((a) => (
            <DraftAttachChip
              key={`d-${a.id}`}
              dealId={dealId}
              file={a}
              onRemove={async () => {
                // Optimistic remove; persist server-side so it doesn't re-appear on reopen
                setDraftAttachments((prev) => prev.filter((x) => x.id !== a.id));
                try { await removeDraftAttachment(dealId, a.id); }
                catch { /* non-fatal — local state already updated */ }
              }}
            />
          ))}
          {attachments.map((a, i) => (
            <AttachChip key={`m-${i}`} file={a} onRemove={() => setAttachments((prev) => prev.filter((_, j) => j !== i))} />
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="shrink-0 px-3 py-1.5 bg-red-50 border-t border-red-200">
          <p className="text-xs text-red-600">{error}</p>
        </div>
      )}

      {/* Footer */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2.5 border-t border-slate-200 bg-slate-50">
        <button
          onClick={handleSend}
          disabled={sending || !to.length}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
        >
          {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          {sending ? "Sending…" : "Send"}
        </button>
        <button
          onClick={handleSaveDraft}
          disabled={saving || sending}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
            saved
              ? "border-emerald-200 bg-emerald-50 text-emerald-600"
              : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
          }`}
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
          {saving ? "Saving…" : saved ? "Saved" : "Save Draft"}
        </button>
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelect} />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 transition-colors"
        >
          <Paperclip className="h-3.5 w-3.5" />
          Attach
        </button>
        <button
          type="button"
          onClick={handleDiscard}
          disabled={discarding || sending || saving}
          title={draftId ? "Delete this draft" : "Discard changes"}
          className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-red-600 transition-colors disabled:opacity-50"
        >
          {discarding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          {discarding ? "Discarding…" : "Discard"}
        </button>
        <span className="ml-auto text-[10px] text-slate-400">
          {(() => {
            const total = attachments.length + draftAttachments.length;
            return total > 0 ? `${total} file${total > 1 ? "s" : ""}` : "";
          })()}
        </span>
      </div>
    </div>
  );
}
