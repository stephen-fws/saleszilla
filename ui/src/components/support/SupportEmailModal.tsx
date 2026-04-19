import { useState, useEffect } from "react";
import { X, Headphones, Send, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { sendSupportEmail, getSupportCategories } from "@/lib/api";
import type { PotentialDetail } from "@/types";

interface SupportEmailModalProps {
  isOpen: boolean;
  onClose: () => void;
  dealId: string;
  detail: PotentialDetail | null;
  defaultCategory?: string;
}

export default function SupportEmailModal({
  isOpen,
  onClose,
  dealId,
  detail,
  defaultCategory,
}: SupportEmailModalProps) {
  const [categories, setCategories] = useState<Record<string, string>>({});
  const [category, setCategory] = useState<string>(defaultCategory ?? "other");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    getSupportCategories().then(setCategories).catch(() => {});
    setCategory(defaultCategory ?? "other");
    setMessage("");
    setSent(false);
    setError(null);
  }, [isOpen, defaultCategory]);

  if (!isOpen) return null;

  async function handleSend() {
    setSending(true);
    setError(null);
    try {
      await sendSupportEmail({ potentialId: dealId, category, message });
      setSent(true);
      setTimeout(() => onClose(), 1800);
    } catch (err) {
      setError((err as Error).message || "Failed to send support email.");
    } finally {
      setSending(false);
    }
  }

  const dealName = detail?.title || "(untitled)";
  const companyName = detail?.company?.name || "—";
  const contactName = detail?.contact?.name || "—";
  const potentialNumber = detail?.potentialNumber || "—";
  const stage = detail?.stage || "—";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-xl mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with potential summary */}
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 px-5 py-4 border-b border-slate-200">
          <div className="flex items-start justify-between mb-2">
            <div className="flex items-center gap-2">
              <Headphones className="h-5 w-5 text-blue-600" />
              <h3 className="text-sm font-semibold text-slate-900">Contact Support</h3>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="text-xs text-slate-600 space-y-0.5">
            <div><span className="font-mono text-slate-500">#{potentialNumber}</span> · <span className="font-medium text-slate-800">{dealName}</span></div>
            <div>{companyName} · {contactName} · <span className="text-slate-500">{stage}</span></div>
          </div>
        </div>

        {sent ? (
          <div className="px-5 py-10 flex flex-col items-center text-center">
            <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center mb-3">
              <CheckCircle2 className="h-7 w-7 text-emerald-500" />
            </div>
            <p className="text-sm font-semibold text-slate-700">Support email sent</p>
            <p className="text-xs text-slate-500 mt-1">Our team will get back to you shortly.</p>
          </div>
        ) : (
          <>
            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Issue category</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  disabled={sending}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                >
                  {Object.entries(categories).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                  Additional details <span className="font-normal text-slate-400">(optional)</span>
                </label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  disabled={sending}
                  placeholder="Describe the issue — what you were trying to do, what happened, any error messages…"
                  rows={5}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 resize-none"
                />
              </div>

              <p className="text-[11px] text-slate-400 leading-relaxed">
                Potential details (#, company, contact, owner) will be included automatically.
              </p>

              {error && (
                <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-600">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-3 bg-slate-50 border-t border-slate-200">
              <button
                onClick={onClose}
                disabled={sending}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSend}
                disabled={sending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                {sending ? "Sending…" : "Send to Support"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
