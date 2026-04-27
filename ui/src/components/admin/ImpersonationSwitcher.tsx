/**
 * Top-bar dropdown for superadmins. Lists all active users and switches the
 * "viewing as" target. The selection is persisted in localStorage and the
 * axios interceptor sends it as `X-Impersonate-User-Id` on every request,
 * so the rest of the app naturally re-fetches data scoped to that user.
 */

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Eye, X, Search, Loader2 } from "lucide-react";
import { listAdminUsers } from "@/lib/api";
import type { AdminUser } from "@/types";
import { useImpersonationStore } from "@/store/impersonationStore";

export default function ImpersonationSwitcher() {
  const viewingAs = useImpersonationStore((s) => s.viewingAs);
  const setViewingAs = useImpersonationStore((s) => s.setViewingAs);
  const clearViewingAs = useImpersonationStore((s) => s.clearViewingAs);

  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  useEffect(() => {
    if (!open || users.length > 0) return;
    setLoading(true);
    listAdminUsers()
      .then(setUsers)
      .catch(() => setUsers([]))
      .finally(() => setLoading(false));
  }, [open, users.length]);

  const filtered = query.trim()
    ? users.filter((u) =>
        u.name.toLowerCase().includes(query.toLowerCase()) ||
        u.email.toLowerCase().includes(query.toLowerCase()),
      )
    : users;

  function pick(u: AdminUser) {
    setViewingAs({ userId: u.userId, name: u.name, email: u.email });
    setOpen(false);
    // Hard reload so every component refetches under the impersonated lens.
    // Cheaper than wiring a global "refresh everything" event for what's a
    // rare admin action.
    window.location.reload();
  }

  function clear() {
    clearViewingAs();
    setOpen(false);
    window.location.reload();
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
          viewingAs
            ? "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
            : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
        }`}
        title={viewingAs ? `Viewing as ${viewingAs.name}` : "View as another user"}
      >
        <Eye className="h-3.5 w-3.5" />
        <span className="max-w-[140px] truncate">
          {viewingAs ? `Viewing: ${viewingAs.name}` : "View as…"}
        </span>
        <ChevronDown className="h-3 w-3 text-slate-400" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-72 rounded-lg border border-slate-200 bg-white shadow-lg z-50 overflow-hidden">
          <div className="px-2 py-2 border-b border-slate-100">
            <div className="relative">
              <Search className="h-3 w-3 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search users…"
                className="w-full rounded border border-slate-200 pl-7 pr-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>
          </div>

          {viewingAs && (
            <button
              onClick={clear}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 border-b border-slate-100"
            >
              <X className="h-3 w-3 text-slate-400" />
              <span className="flex-1 text-left">Stop viewing as {viewingAs.name}</span>
            </button>
          )}

          <div className="max-h-72 overflow-y-auto scrollbar-thin">
            {loading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
              </div>
            ) : filtered.length === 0 ? (
              <p className="text-center text-[11px] text-slate-400 py-6">No users found.</p>
            ) : (
              filtered.map((u) => {
                const isActive = viewingAs?.userId === u.userId;
                return (
                  <button
                    key={u.userId}
                    onClick={() => pick(u)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors ${
                      isActive ? "bg-amber-50 text-amber-800" : "hover:bg-slate-50 text-slate-700"
                    }`}
                  >
                    <div className="flex-1 min-w-0 text-left">
                      <p className="font-medium truncate">{u.name || u.email}</p>
                      {u.name && (
                        <p className="text-[10px] text-slate-400 truncate">{u.email}</p>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
