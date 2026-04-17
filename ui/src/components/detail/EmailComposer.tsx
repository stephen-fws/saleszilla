import { useState, useRef, useCallback } from "react";
import {
  X, Send, Save, Paperclip, Loader2, Check,
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
import type { EmailDraft, EmailAttachment } from "@/types";
import { createEmailDraft, updateEmailDraft, sendEmail } from "@/lib/api";

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

function RichEditor({
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

// ── Main composer ─────────────────────────────────────────────────────────────

interface EmailComposerProps {
  dealId: string;
  initialDraft?: EmailDraft | null;
  contactEmail?: string | null;
  contactName?: string | null;
  signature?: string | null;
  isNextAction?: boolean;
  onClose: () => void;
  onSent: () => void;
  onDraftSaved: (draft: EmailDraft) => void;
}

export default function EmailComposer({
  dealId, initialDraft, contactEmail, contactName, signature,
  isNextAction = false,
  onClose, onSent, onDraftSaved,
}: EmailComposerProps) {
  // id=0 is the "not yet persisted" sentinel from agent-generated drafts
  const [draftId, setDraftId] = useState<number | null>(
    initialDraft?.id ? initialDraft.id : null
  );
  const [to, setTo] = useState<string[]>(
    initialDraft?.toEmail ? [initialDraft.toEmail] : contactEmail ? [contactEmail] : []
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
  const [attachments, setAttachments] = useState<EmailAttachment[]>([]);
  const [showCc, setShowCc] = useState((initialDraft?.ccEmails?.length ?? 0) > 0);
  const [showBcc, setShowBcc] = useState((initialDraft?.bccEmails?.length ?? 0) > 0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // The editor holds the entire email content (including signature). Send/save
  // use `body` as-is — no post-hoc signature appending.
  function getFullBody() {
    return body;
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    files.forEach((file) => {
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
      };
      if (draftId) {
        const updated = await updateEmailDraft(dealId, draftId, payload);
        onDraftSaved(updated);
      } else {
        const created = await createEmailDraft(dealId, payload, isNextAction);
        setDraftId(created.id);
        onDraftSaved(created);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      console.error("[EmailComposer] save draft failed:", err);
      setError("Failed to save draft");
    } finally {
      setSaving(false);
    }
  }

  async function handleSend() {
    if (!to.length) { setError("Please add at least one recipient"); return; }
    if (!subject.trim()) { setError("Subject is required"); return; }
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

      {/* Body — signature is part of the editable content, inserted at mount */}
      <div className="flex-1 min-h-0 flex flex-col">
        <RichEditor initialValue={body} onChange={setBody} placeholder="Write your email…" />
      </div>

      {/* Attachments */}
      {attachments.length > 0 && (
        <div className="shrink-0 flex flex-wrap gap-1.5 px-3 py-2 border-t border-slate-100">
          {attachments.map((a, i) => (
            <AttachChip key={i} file={a} onRemove={() => setAttachments((prev) => prev.filter((_, j) => j !== i))} />
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
        <span className="ml-auto text-[10px] text-slate-400">
          {attachments.length > 0 && `${attachments.length} file${attachments.length > 1 ? "s" : ""}`}
        </span>
      </div>
    </div>
  );
}
