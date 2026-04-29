import { Building2, Users, Briefcase } from "lucide-react";
import type { AccountSummary } from "@/types";

function formatValue(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value}`;
}

interface AccountsListProps {
  accounts: AccountSummary[];
  selectedAccountId: string | null;
  onSelectAccount: (id: string) => void;
  loading: boolean;
  // Pagination — total is the server-side count across all pages.
  page?: number;
  pageSize?: number;
  total?: number;
  onPageChange?: (page: number) => void;
}

export default function AccountsList({
  accounts,
  selectedAccountId,
  onSelectAccount,
  loading,
  page = 1,
  pageSize = 50,
  total = 0,
  onPageChange,
}: AccountsListProps) {
  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex h-14 items-center justify-between border-b border-slate-200 px-4">
        <span className="text-sm font-semibold text-slate-900">
          {total > 0
            ? `${total.toLocaleString()} ${total === 1 ? "account" : "accounts"}`
            : `${accounts.length} ${accounts.length === 1 ? "account" : "accounts"}`}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {loading ? (
          <div className="divide-y divide-slate-100">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="p-3">
                <div className="flex items-start gap-3">
                  <div className="h-9 w-9 animate-pulse rounded-full bg-slate-100" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-3/4 animate-pulse rounded bg-slate-100" />
                    <div className="h-3 w-1/2 animate-pulse rounded bg-slate-100" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : accounts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Building2 className="h-8 w-8 text-slate-300 mb-2" />
            <p className="text-sm text-slate-500">No accounts found</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {accounts.map((account) => {
              const isSelected = account.id === selectedAccountId;
              return (
                <button
                  key={account.id}
                  onClick={() => onSelectAccount(account.id)}
                  className={`w-full p-3 text-left transition-colors ${
                    isSelected
                      ? "bg-blue-50 border-l-2 border-l-blue-500"
                      : "hover:bg-slate-50 border-l-2 border-l-transparent"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ${
                        isSelected ? "bg-blue-100 text-blue-600" : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      <Building2 className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-sm font-medium truncate ${isSelected ? "text-blue-900" : "text-slate-900"}`}>
                          {account.name}
                        </span>
                        {account.totalValue > 0 && (
                          <span className="flex-shrink-0 text-xs font-semibold text-emerald-600">
                            {formatValue(account.totalValue)}
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-slate-500 truncate block mt-0.5">
                        {account.industry}
                        {account.location && ` · ${account.location}`}
                      </span>
                      <div className="flex items-center gap-2.5 mt-1.5">
                        {account.dealCount > 0 && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] text-slate-400">
                            <Briefcase className="h-3 w-3" />
                            {account.dealCount} {account.dealCount === 1 ? "potential" : "potentials"}
                          </span>
                        )}
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-slate-400">
                          <Users className="h-3 w-3" />
                          {account.contactCount}
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
      {total > pageSize && onPageChange && (
        <Pager page={page} pageSize={pageSize} total={total} onPageChange={onPageChange} />
      )}
    </div>
  );
}

// ── Pager ───────────────────────────────────────────────────────────────────
// Mirrors the Pager in PotentialsList — kept local rather than centralised
// since neither file shares much else and a one-component "lib" feels overkill.
function Pager({
  page, pageSize, total, onPageChange,
}: {
  page: number; pageSize: number; total: number; onPageChange: (p: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const from = (safePage - 1) * pageSize + 1;
  const to = Math.min(safePage * pageSize, total);
  const canPrev = safePage > 1;
  const canNext = safePage < totalPages;
  return (
    <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600 shrink-0">
      <span>
        Showing <span className="font-medium text-slate-800">{from.toLocaleString()}–{to.toLocaleString()}</span> of <span className="font-medium text-slate-800">{total.toLocaleString()}</span>
      </span>
      <div className="flex items-center gap-1">
        <button
          onClick={() => canPrev && onPageChange(safePage - 1)}
          disabled={!canPrev}
          className="rounded border border-slate-200 bg-white px-2 py-1 text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Prev
        </button>
        <span className="px-1 text-slate-500">
          {safePage}/{totalPages}
        </span>
        <button
          onClick={() => canNext && onPageChange(safePage + 1)}
          disabled={!canNext}
          className="rounded border border-slate-200 bg-white px-2 py-1 text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Next
        </button>
      </div>
    </div>
  );
}
