import { useEffect, useMemo, useState } from "react";
import { X, Loader2, UserCheck, Search, AlertTriangle } from "lucide-react";
import { listUsers, reassignPotential } from "@/lib/api";
import type { AdminUser } from "@/types";

interface ReassignDialogProps {
  potentialId: string;
  potentialName: string | null;
  currentOwnerId: string | null;
  currentOwnerName: string | null;
  onClose: (reassigned?: boolean) => void;
}

export default function ReassignDialog({
  potentialId,
  potentialName,
  currentOwnerId,
  currentOwnerName,
  onClose,
}: ReassignDialogProps) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Two-step flow inside the same modal: "pick" the target user, then
  // "confirm" the action before we actually call the API.
  const [step, setStep] = useState<"pick" | "confirm">("pick");

  useEffect(() => {
    let cancelled = false;
    listUsers()
      .then((rows) => { if (!cancelled) setUsers(rows); })
      .catch((err) => { if (!cancelled) setError((err as Error).message || "Failed to load users"); })
      .finally(() => { if (!cancelled) setLoadingUsers(false); });
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = users.filter((u) => u.userId !== currentOwnerId);
    if (!q) return list;
    return list.filter((u) =>
      (u.name || "").toLowerCase().includes(q) ||
      (u.email || "").toLowerCase().includes(q)
    );
  }, [users, search, currentOwnerId]);

  async function handleConfirm() {
    if (!selectedUserId) return;
    setSaving(true);
    setError(null);
    try {
      await reassignPotential(potentialId, selectedUserId);
      onClose(true);
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const detail = (err as any)?.response?.data?.message || (err as Error).message || "Failed to reassign";
      setError(detail);
      setStep("pick"); // surface the error on the picker step
    } finally {
      setSaving(false);
    }
  }

  const selected = users.find((u) => u.userId === selectedUserId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <UserCheck className="h-4 w-4 text-blue-600" />
            <h3 className="text-sm font-semibold text-slate-900">Reassign Potential</h3>
          </div>
          <button onClick={() => onClose(false)} className="rounded-md p-1 text-slate-400 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-600">
            <div className="font-medium text-slate-800 truncate">{potentialName || "(untitled)"}</div>
            <div>Currently owned by <span className="font-medium">{currentOwnerName || "—"}</span></div>
          </div>

          {step === "pick" ? (
            <>
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name or email…"
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-300 focus:bg-white"
                />
              </div>

              {/* User list */}
              <div className="rounded-lg border border-slate-200 max-h-64 overflow-y-auto scrollbar-thin">
                {loadingUsers ? (
                  <div className="flex items-center gap-2 px-3 py-4 text-xs text-slate-400">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Loading users…</span>
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="px-3 py-4 text-xs text-slate-400 text-center">
                    {search ? "No matches" : "No other users"}
                  </div>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {filtered.map((u) => {
                      const isSelected = u.userId === selectedUserId;
                      return (
                        <li key={u.userId}>
                          <button
                            onClick={() => setSelectedUserId(u.userId)}
                            className={`w-full text-left px-3 py-2 text-xs transition-colors ${
                              isSelected ? "bg-blue-50 text-blue-900" : "hover:bg-slate-50 text-slate-700"
                            }`}
                          >
                            <div className="font-medium truncate">{u.name || "(no name)"}</div>
                            <div className="text-[11px] text-slate-500 truncate">{u.email}</div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </>
          ) : (
            // Confirmation step
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-2.5">
              <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <div className="flex-1 text-xs text-slate-700 space-y-1.5">
                <p className="font-medium text-slate-800">Reassign to {selected?.name || selected?.email}?</p>
                <p className="text-slate-600">
                  This potential will move out of <span className="font-medium">{currentOwnerName || "the current owner"}</span>'s
                  queue and into <span className="font-medium">{selected?.name || selected?.email}</span>'s.
                </p>
                <p className="text-slate-600">
                  Any existing draft is preserved — the new owner may want to tweak the signature/tone in the composer before sending.
                </p>
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50">
          {step === "pick" ? (
            <>
              <button
                onClick={() => onClose(false)}
                disabled={saving}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => { setError(null); setStep("confirm"); }}
                disabled={!selectedUserId}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                <UserCheck className="h-3.5 w-3.5" />
                {selected ? `Reassign to ${selected.name || selected.email}` : "Reassign"}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setStep("pick")}
                disabled={saving}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
              >
                Back
              </button>
              <button
                onClick={handleConfirm}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserCheck className="h-3.5 w-3.5" />}
                {saving ? "Reassigning…" : "Confirm Reassign"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
