import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown, Minus, X, Trophy, Building2 } from "lucide-react";
import { getSalesTargetSummary } from "@/lib/api";
import type { SalesTargetSummary, SalesTopDeal } from "@/types";

function fmt(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function TopDealsModal({
  data,
  onClose,
}: {
  data: SalesTargetSummary;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-start"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/20" />

      {/* Panel — appears above the widget, anchored to left */}
      <div
        className="relative mb-[72px] ml-2 w-72 rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50">
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-amber-500" />
            <span className="text-sm font-semibold text-slate-800">
              Top Accounts — {data.periodLabel}
            </span>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Month summary row */}
        <div className="grid grid-cols-2 divide-x divide-slate-100 border-b border-slate-100">
          <div className="px-4 py-2.5 text-center">
            <p className="text-[10px] uppercase font-semibold text-slate-400 tracking-wide">Actuals</p>
            <p className="text-base font-bold text-slate-900">{fmt(data.actuals)}</p>
            <p className="text-[10px] text-slate-400">of {fmt(data.target)} target</p>
          </div>
          <div className="px-4 py-2.5 text-center">
            <p className="text-[10px] uppercase font-semibold text-slate-400 tracking-wide">vs {data.prevPeriodLabel}</p>
            <p className={`text-base font-bold ${data.pctChange >= 0 ? "text-emerald-600" : "text-red-500"}`}>
              {data.pctChange >= 0 ? "+" : ""}{data.pctChange.toFixed(1)}%
            </p>
            <p className="text-[10px] text-slate-400">{fmt(data.prevActuals)} prev</p>
          </div>
        </div>

        {/* Top accounts list */}
        <div className="overflow-y-auto max-h-64 scrollbar-thin">
          {data.topClosed.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-6">No invoiced accounts this month</p>
          ) : (
            <ul className="divide-y divide-slate-50">
              {data.topClosed.map((deal, i) => (
                <TopAccountRow key={i} rank={i + 1} deal={deal} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function TopAccountRow({ rank, deal }: { rank: number; deal: SalesTopDeal }) {
  return (
    <li className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors">
      <span className="w-5 text-[11px] font-bold text-slate-300 text-center shrink-0">
        {rank}
      </span>
      <Building2 className="h-3.5 w-3.5 text-slate-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-slate-800 truncate">
          {deal.companyName || "—"}
        </p>
      </div>
      <span className="text-xs font-semibold text-emerald-700 shrink-0">{fmt(deal.amount)}</span>
    </li>
  );
}

export default function TargetWidget() {
  const [data, setData] = useState<SalesTargetSummary | null>(null);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    getSalesTargetSummary()
      .then(setData)
      .catch((e) => setErr(e?.response?.data?.message ?? e?.message ?? "error"));
  }, []);

  if (err) {
    return (
      <div className="w-full px-3 py-3 border-t border-slate-100 bg-white">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">Monthly Target</span>
        </div>
        <p className="text-[11px] text-slate-400">No target data available for your account.</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="px-3 py-2 border-t border-slate-100 text-[10px] text-slate-400 animate-pulse">
        Loading target…
      </div>
    );
  }

  if (data.target === 0 && data.actuals === 0) return null;

  const pct = Math.min(data.pctOfTarget, 100);
  const over = data.pctOfTarget > 100;
  const change = data.pctChange;

  const barColor = over
    ? "bg-emerald-500"
    : pct >= 75
    ? "bg-blue-500"
    : pct >= 40
    ? "bg-amber-400"
    : "bg-red-400";

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-full text-left px-3 py-2.5 border-t border-slate-100 bg-white hover:bg-slate-50 transition-colors group"
      >
        {/* Label row */}
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">
            {data.periodLabel} Target
          </span>
          <div className="flex items-center gap-1">
            {change > 0 ? (
              <TrendingUp className="h-3 w-3 text-emerald-500" />
            ) : change < 0 ? (
              <TrendingDown className="h-3 w-3 text-red-400" />
            ) : (
              <Minus className="h-3 w-3 text-slate-300" />
            )}
            <span className={`text-[10px] font-semibold ${change > 0 ? "text-emerald-600" : change < 0 ? "text-red-500" : "text-slate-400"}`}>
              {change >= 0 ? "+" : ""}{change.toFixed(1)}% vs {data.prevPeriodLabel}
            </span>
          </div>
        </div>

        {/* Progress bar */}
        <div className="w-full h-1.5 rounded-full bg-slate-100 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${barColor}`}
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* Amount row */}
        <div className="flex items-center justify-between mt-1">
          <span className="text-[11px] font-semibold text-slate-700">
            {fmt(data.actuals)}
            <span className="text-slate-400 font-normal"> / {fmt(data.target)}</span>
          </span>
          <span className={`text-[11px] font-bold ${over ? "text-emerald-600" : "text-slate-600"}`}>
            {data.pctOfTarget.toFixed(1)}%
          </span>
        </div>
      </button>

      {open && <TopDealsModal data={data} onClose={() => setOpen(false)} />}
    </>
  );
}
