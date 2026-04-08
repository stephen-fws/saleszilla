import { useState, useRef, useEffect } from "react";
import { Building2, User, Briefcase, Mail, Globe, Loader2, Pencil, X } from "lucide-react";
import type { PotentialDetail } from "@/types";
import type { UpdatePotentialPayload } from "@/lib/api";


const STAGE_COLORS: Record<string, string> = {
  // Real DB stage names
  Prospects: "bg-slate-100 text-slate-700",
  "Pre Qualified": "bg-blue-100 text-blue-700",
  "Requirements Capture": "bg-indigo-100 text-indigo-700",
  Proposal: "bg-amber-100 text-amber-700",
  Contracting: "bg-orange-100 text-orange-700",
  Closed: "bg-emerald-100 text-emerald-700",
  "Contact Later": "bg-slate-100 text-slate-600",
  Sleeping: "bg-slate-100 text-slate-500",
  "Low Value": "bg-slate-100 text-slate-500",
  Disqualified: "bg-red-100 text-red-600",
  Lost: "bg-red-100 text-red-700",
  // Normalized names (mock/fallback)
  prospect: "bg-slate-100 text-slate-700",
  qualification: "bg-blue-100 text-blue-700",
  proposal: "bg-amber-100 text-amber-700",
  negotiation: "bg-orange-100 text-orange-700",
  "closed-won": "bg-emerald-100 text-emerald-700",
  "closed-lost": "bg-red-100 text-red-700",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCurrency(value: number | null | undefined): string | null {
  if (value == null) return null;
  return `$${Number(value).toLocaleString()}`;
}

function formatDate(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return value;
  }
}

function toISODate(value: string | null | undefined): string {
  if (!value) return "";
  try {
    return new Date(value).toISOString().split("T")[0];
  } catch {
    return "";
  }
}

// ── Read-only field ───────────────────────────────────────────────────────────

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  const display = value === null || value === undefined || value === "" ? "—" : String(value);
  return (
    <div className="py-1">
      <p className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider mb-0.5">{label}</p>
      <p className="text-sm text-slate-700">{display}</p>
    </div>
  );
}

// ── Editable text/number field ────────────────────────────────────────────────

function EditableField({
  label,
  value,
  type = "text",
  min,
  max,
  displayFormatter,
  onSave,
}: {
  label: string;
  value: string | number | null | undefined;
  type?: "text" | "number" | "date";
  min?: number;
  max?: number;
  displayFormatter?: (val: string | number | null | undefined) => string | null;
  onSave: (val: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(
    type === "date" ? toISODate(value as string) : String(value ?? "")
  );
  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  async function commit() {
    if (type === "number" && draft !== "") {
      const n = parseFloat(draft);
      if (min !== undefined && n < min) { setValidationError(`Min ${min}`); return; }
      if (max !== undefined && n > max) { setValidationError(`Max ${max}`); return; }
    }
    setValidationError(null);
    const original = type === "date" ? toISODate(value as string) : String(value ?? "");
    if (draft === original) { setEditing(false); return; }
    setSaving(true);
    try { await onSave(draft); } finally { setSaving(false); setEditing(false); }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter") commit();
    if (e.key === "Escape") {
      setDraft(type === "date" ? toISODate(value as string) : String(value ?? ""));
      setValidationError(null);
      setEditing(false);
    }
  }

  function startEdit() {
    setDraft(type === "date" ? toISODate(value as string) : String(value ?? ""));
    setValidationError(null);
    setEditing(true);
  }

  const displayValue = displayFormatter
    ? displayFormatter(value)
    : type === "date"
      ? formatDate(value as string)
      : (value != null && value !== "" ? String(value) : null);

  if (editing) {
    return (
      <div className="py-1">
        <p className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider mb-0.5">{label}</p>
        <div className="flex items-center gap-1">
          <div className="flex-1">
            <input
              autoFocus
              type={type}
              value={draft}
              min={min}
              max={max}
              onChange={(e) => { setDraft(e.target.value); setValidationError(null); }}
              onKeyDown={handleKey}
              onBlur={commit}
              className={`w-full rounded border px-2 py-1 text-xs text-slate-900 focus:outline-none focus:ring-1 ${validationError ? "border-red-400 focus:ring-red-400" : "border-blue-300 focus:ring-blue-400"}`}
            />
            {validationError && (
              <p className="text-[10px] text-red-500 mt-0.5">{validationError}</p>
            )}
          </div>
          {saving
            ? <Loader2 className="h-3 w-3 animate-spin text-blue-500 shrink-0" />
            : <button type="button" onMouseDown={(e) => { e.preventDefault(); setDraft(String(value ?? "")); setValidationError(null); setEditing(false); }}><X className="h-3 w-3 text-slate-400 hover:text-slate-600" /></button>
          }
        </div>
      </div>
    );
  }

  return (
    <div className="py-1 group">
      <div className="flex items-center gap-1 mb-0.5">
        <p className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">{label}</p>
        <Pencil className="h-2 w-2 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
      <div
        onClick={startEdit}
        className="text-sm text-slate-700 cursor-pointer rounded px-1.5 py-0.5 -mx-1.5 hover:bg-slate-100 transition-colors"
      >
        {displayValue ?? "—"}
      </div>
    </div>
  );
}

// ── Linkified text ────────────────────────────────────────────────────────────

const URL_REGEX = /https?:\/\/[^\s,）\]>'"]+/g;

/**
 * Some inbound chat-form transcripts arrive as one giant single-line string
 * where newlines were collapsed into spaces. Detect chat-style timestamps and
 * known section headers, and insert real newlines so each message renders on
 * its own line.
 */
function normalizeChatTranscript(text: string): string {
  if (!text) return text;
  // Quick exit for normal short text
  const looksLikeChatTranscript =
    /\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}:\d{2}\s+(?:AM|PM)/i.test(text) ||
    /\bChat (Started|Message|Information|ID)\b/i.test(text);
  if (!looksLikeChatTranscript) return text;

  let out = text;

  // 1) Newline before each chat message timestamp ("YYYY-MM-DD HH:MM:SS AM/PM ...")
  //    when preceded by 2+ whitespace (not already on its own line)
  out = out.replace(
    /\s{2,}(\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}:\d{2}\s+(?:AM|PM))/gi,
    "\n$1",
  );

  // 2) Double newline before major section headers
  const SECTIONS = [
    "Form Type:",
    "CHAT INFORMATION:",
    "Chat Message:",
    "Chat Started At:",
    "Chat ID:",
    "Chat Started URL:",
    "City:",
    "Country:",
    "Visitor Name:",
    "Referrer:",
    "ClientID:",
    "Agent Email:",
    "Attempted to Transfer Chat?:",
    "Reason-ATC-No?:",
    "Reason-ATC-No-Others?:",
    "SalesOfficialWorkHours?:",
    "IST-SOWH:",
  ];
  for (const label of SECTIONS) {
    // Escape regex special chars in label
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`\\s{2,}(${escaped})`, "g"), "\n$1");
  }

  // 3) Collapse 3+ consecutive newlines down to 2 for tidiness
  out = out.replace(/\n{3,}/g, "\n\n");

  return out.trim();
}

function LinkifiedText({ text }: { text: string }) {
  const normalized = normalizeChatTranscript(text);
  const parts: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  URL_REGEX.lastIndex = 0;
  while ((match = URL_REGEX.exec(normalized)) !== null) {
    if (match.index > last) parts.push(normalized.slice(last, match.index));
    const url = match[0];
    parts.push(
      <a
        key={match.index}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-600 hover:underline break-all"
        onClick={(e) => e.stopPropagation()}
      >
        {url}
      </a>
    );
    last = match.index + url.length;
  }
  if (last < normalized.length) parts.push(normalized.slice(last));
  return <span className="whitespace-pre-wrap">{parts}</span>;
}

// ── Editable textarea ─────────────────────────────────────────────────────────

function EditableTextarea({
  label,
  value,
  onSave,
}: {
  label: string;
  value: string | null | undefined;
  onSave: (val: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow the textarea to fit content while editing
  useEffect(() => {
    if (!editing || !taRef.current) return;
    const ta = taRef.current;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(Math.max(ta.scrollHeight, 200), 600)}px`;
  }, [editing, draft]);

  async function commit() {
    if (draft === (value ?? "")) { setEditing(false); return; }
    setSaving(true);
    try { await onSave(draft); } finally { setSaving(false); setEditing(false); }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") { setDraft(value ?? ""); setEditing(false); }
    // Shift+Enter submits, plain Enter is newline
    if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); commit(); }
  }

  function startEditing() {
    // Pre-format the draft so the user edits the readable, line-broken version
    // — newlines persist back to DB on save, so future renders are clean too.
    setDraft(normalizeChatTranscript(value ?? ""));
    setEditing(true);
  }

  if (editing) {
    return (
      <div className="py-1">
        <div className="flex items-center justify-between mb-0.5">
          <p className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">{label}</p>
          <p className="text-[10px] text-slate-400">Shift+Enter to save · Esc to cancel</p>
        </div>
        <div className="relative">
          <textarea
            ref={taRef}
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKey}
            onBlur={commit}
            className="w-full rounded border border-blue-300 px-2 py-1.5 text-xs leading-relaxed text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-400 resize-y min-h-[200px] font-mono"
          />
          {saving && (
            <Loader2 className="absolute bottom-2 right-2 h-3 w-3 animate-spin text-blue-500" />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="py-1 group">
      <div className="flex items-center gap-1 mb-0.5">
        <p className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">{label}</p>
        <Pencil className="h-2 w-2 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
      <div
        onClick={startEditing}
        className="text-sm text-slate-700 cursor-pointer rounded px-1.5 py-0.5 -mx-1.5 hover:bg-slate-100 transition-colors"
      >
        {value ? <LinkifiedText text={value} /> : <span className="text-slate-400">—</span>}
      </div>
    </div>
  );
}

// ── Editable stage select ─────────────────────────────────────────────────────

function EditableStage({
  value,
  availableStages,
  onSave,
}: {
  value: string | null | undefined;
  availableStages: string[];
  onSave: (val: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setPending(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  function handleSelect(newStage: string) {
    if (newStage === (value ?? "")) { setOpen(false); return; }
    setPending(newStage);
  }

  async function confirm() {
    if (!pending) return;
    setSaving(true);
    setOpen(false);
    try { await onSave(pending); } finally { setSaving(false); setPending(null); }
  }

  const colorClass = STAGE_COLORS[value ?? ""] ?? "bg-slate-100 text-slate-600";

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); setPending(null); }}
        className={`inline-flex items-center gap-1 text-[11px] px-2.5 py-0.5 rounded-full font-medium group hover:opacity-80 transition-opacity ${colorClass}`}
        title="Click to change stage"
      >
        {saving ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : (value ?? "—")}
        {!saving && <Pencil className="h-2 w-2 opacity-0 group-hover:opacity-60 transition-opacity" />}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 min-w-[170px] rounded-lg border border-slate-200 bg-white shadow-lg py-1">
          {pending ? (
            <div className="px-3 py-2 space-y-2">
              <p className="text-[11px] text-slate-600">
                Change stage to{" "}
                <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 font-medium ${STAGE_COLORS[pending] ?? "bg-slate-100 text-slate-600"}`}>
                  {pending}
                </span>
                ?
              </p>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={confirm}
                  className="flex-1 rounded-md bg-blue-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-blue-700 transition-colors"
                >
                  Confirm
                </button>
                <button
                  type="button"
                  onClick={() => setPending(null)}
                  className="flex-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            availableStages.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => handleSelect(s)}
                className={`w-full text-left px-3 py-1.5 text-xs transition-colors flex items-center gap-2 ${
                  s === (value ?? "") ? "bg-blue-50 text-blue-700 font-medium" : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                <span className={`inline-block w-2 h-2 rounded-full ${STAGE_COLORS[s]?.split(" ")[0] ?? "bg-slate-300"}`} />
                {s}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

// ── Editable select (generic dropdown, no color badges) ───────────────────────

function EditableSelect({
  label,
  value,
  options,
  onSave,
}: {
  label: string;
  value: string | null | undefined;
  options: string[];
  onSave: (val: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  async function handleSelect(val: string) {
    if (val === (value ?? "")) { setOpen(false); return; }
    setOpen(false);
    setSaving(true);
    try { await onSave(val); } finally { setSaving(false); }
  }

  return (
    <div ref={ref} className="py-1 relative">
      <p className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider mb-0.5">{label}</p>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group flex items-center gap-1 text-sm text-slate-700 rounded px-1.5 py-0.5 -mx-1.5 hover:bg-slate-100 transition-colors w-full text-left"
      >
        {saving ? <Loader2 className="h-3 w-3 animate-spin text-blue-500" /> : (value ?? "—")}
        {!saving && <Pencil className="h-2 w-2 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity ml-auto shrink-0" />}
      </button>
      {open && options.length > 0 && (
        <div className="absolute left-0 top-full mt-1 z-30 min-w-[180px] max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg py-1">
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => handleSelect(opt)}
              className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                opt === (value ?? "") ? "bg-blue-50 text-blue-700 font-medium" : "text-slate-700 hover:bg-slate-50"
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface DetailsTabProps {
  detail: PotentialDetail;
  availableStages: string[];
  availableServices: string[];
  onFieldSave: (field: keyof UpdatePotentialPayload, raw: string) => Promise<void>;
}

export default function DetailsTab({ detail, availableStages, availableServices, onFieldSave }: DetailsTabProps) {
  const { contact, company } = detail;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-4 space-y-4">

        {/* Deal / Opportunity */}
        <div className="rounded-lg border border-slate-200 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 border-b border-slate-200">
            <Briefcase className="h-4 w-4 text-slate-500" />
            <h3 className="text-sm font-semibold text-slate-800">Deal / Opportunity</h3>
            <span className="ml-1 text-[11px] font-mono font-semibold text-slate-500 bg-slate-200 rounded px-1.5 py-0.5">
              {detail.potentialNumber ? `#${detail.potentialNumber}` : "—"}
            </span>
            {detail.category === "Diamond" && (
              <span title="Diamond" className="text-base leading-none">💎</span>
            )}
            {detail.category === "Platinum" && (
              <span title="Platinum" className="text-base leading-none">🏆</span>
            )}
            <div className="ml-auto">
              <EditableStage value={detail.stage} availableStages={availableStages} onSave={(v) => onFieldSave("stage", v)} />
            </div>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-2 gap-x-6 gap-y-0.5">
              <div className="col-span-2">
                <EditableField
                  label="Title"
                  value={detail.title}
                  onSave={(v) => onFieldSave("title", v)}
                />
              </div>
              <EditableField
                label="Value"
                value={detail.value ?? ""}
                type="number"
                displayFormatter={(v) => (v != null && v !== "") ? formatCurrency(Number(v)) : null}
                onSave={(v) => onFieldSave("amount", v)}
              />
              <EditableField
                label="Probability (%)"
                value={detail.probability ?? ""}
                type="number"
                min={0}
                max={100}
                onSave={(v) => onFieldSave("probability", v)}
              />
              <EditableField
                label="Closing Date"
                value={detail.closingDate}
                type="date"
                onSave={(v) => onFieldSave("closing_date", v)}
              />
              <Field label="Owner" value={detail.ownerName} />
              <EditableSelect
                label="Service"
                value={detail.service}
                options={availableServices}
                onSave={(v) => onFieldSave("service", v)}
              />
              <EditableField
                label="Sub-service"
                value={detail.subService}
                onSave={(v) => onFieldSave("sub_service", v)}
              />
              <EditableField
                label="Type"
                value={detail.dealType}
                onSave={(v) => onFieldSave("deal_type", v)}
              />
              <EditableField
                label="Deal Size"
                value={detail.dealSize}
                onSave={(v) => onFieldSave("deal_size", v)}
              />
              <EditableField
                label="Lead Source"
                value={detail.leadSource}
                onSave={(v) => onFieldSave("lead_source", v)}
              />
              {detail.createdAt && (
                <Field label="Created" value={formatDate(detail.createdAt)} />
              )}
              <div className="col-span-2 mt-1">
                <EditableField
                  label="Next Step"
                  value={detail.nextStep}
                  onSave={(v) => onFieldSave("next_step", v)}
                />
              </div>
              <div className="col-span-2">
                <EditableTextarea
                  label="Description"
                  value={detail.description}
                  onSave={(v) => onFieldSave("description", v)}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Contact */}
        {contact && (
          <div className="rounded-lg border border-slate-200 overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 border-b border-slate-200">
              <User className="h-4 w-4 text-slate-500" />
              <h3 className="text-sm font-semibold text-slate-800">Contact</h3>
            </div>
            <div className="p-4">
              <div className="grid grid-cols-2 gap-x-6 gap-y-0.5">
                <Field label="Name" value={contact.name} />
                <Field label="Title" value={contact.title} />
                {contact.email && (
                  <div className="col-span-2">
                    <p className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider mb-0.5">Email</p>
                    <a
                      href={`mailto:${contact.email}`}
                      className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
                    >
                      <Mail className="h-3 w-3" />
                      {contact.email}
                    </a>
                  </div>
                )}
                {contact.phone && <Field label="Phone" value={contact.phone} />}
                {contact.mobile && <Field label="Mobile" value={contact.mobile} />}
              </div>
            </div>
          </div>
        )}

        {/* Company */}
        {company && (
          <div className="rounded-lg border border-slate-200 overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 border-b border-slate-200">
              <Building2 className="h-4 w-4 text-slate-500" />
              <h3 className="text-sm font-semibold text-slate-800">Company</h3>
            </div>
            <div className="p-4">
              <div className="grid grid-cols-2 gap-x-6 gap-y-0.5">
                <div className="col-span-2">
                  <Field label="Name" value={company.name} />
                </div>
                <Field label="Industry" value={company.industry} />
                <Field label="Location" value={company.location} />
                <Field label="Employees" value={company.employees} />
                <Field label="Revenue" value={formatCurrency(company.revenue)} />
                {company.website && (
                  <div className="col-span-2 flex items-center gap-1 mt-1">
                    <a
                      href={company.website.startsWith("http") ? company.website : `https://${company.website}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
                    >
                      <Globe className="h-3 w-3" />
                      {company.website}
                    </a>
                  </div>
                )}
                {company.description && (
                  <div className="col-span-2">
                    <Field label="Description" value={company.description} />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
