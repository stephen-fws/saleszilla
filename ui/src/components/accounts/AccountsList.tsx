import { Building2, Users, Briefcase } from "lucide-react";
import type { AccountSummary } from "@/types";

const STAGE_COLORS: Record<string, string> = {
  prospect: "bg-slate-100 text-slate-600",
  qualification: "bg-blue-100 text-blue-700",
  proposal: "bg-amber-100 text-amber-700",
  negotiation: "bg-purple-100 text-purple-700",
  "closed-won": "bg-emerald-100 text-emerald-700",
  "closed-lost": "bg-red-100 text-red-700",
};

function formatValue(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value}`;
}

function formatStage(stage: string): string {
  return stage
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

interface AccountsListProps {
  accounts: AccountSummary[];
  selectedAccountId: string | null;
  onSelectAccount: (id: string) => void;
  loading: boolean;
}

export default function AccountsList({
  accounts,
  selectedAccountId,
  onSelectAccount,
  loading,
}: AccountsListProps) {
  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex h-14 items-center justify-between border-b border-slate-200 px-4">
        <span className="text-sm font-semibold text-slate-900">
          {accounts.length} {accounts.length === 1 ? "account" : "accounts"}
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
    </div>
  );
}
