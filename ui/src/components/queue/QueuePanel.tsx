import { Briefcase, Building2, Check, X } from "lucide-react";
import type { QueueItem } from "@/types";
import { groupByDateBucket } from "@/lib/utils";

const STAGE_BADGE = "bg-slate-100 text-slate-700";



interface QueuePanelProps {
  items: QueueItem[];
  selectedItemId: string | null;
  onSelectItem: (id: string) => void;
  folderType: string;
  loading?: boolean;
  onResolveItem?: (id: string, action: "done" | "skip") => void;
}

function ItemActions({
  itemId,
  onResolve,
}: {
  itemId: string;
  onResolve: (id: string, action: "done" | "skip") => void;
}) {
  return (
    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
      <button
        onClick={(e) => { e.stopPropagation(); onResolve(itemId, "done"); }}
        title="Mark done — I acted on this"
        className="rounded-md p-1 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
      >
        <Check className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onResolve(itemId, "skip"); }}
        title="Skip — not needed"
        className="rounded-md p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export default function QueuePanel({
  items,
  selectedItemId,
  onSelectItem,
  folderType,
  loading = false,
  onResolveItem,
}: QueuePanelProps) {
  // Actions are hidden for "emails-sent" — the user already acted on the potential
  // (sent the email) when it moved into this folder.
  const showActions = folderType !== "emails-sent";

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex h-14 items-center border-b border-slate-200 px-4">
        <span className="text-sm font-semibold text-slate-900">
          {`${items.length} ${items.length === 1 ? "item" : "items"}`}
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
                    <div className="h-3 w-full animate-pulse rounded bg-slate-100" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Building2 className="h-8 w-8 text-slate-300 mb-2" />
            <p className="text-sm text-slate-500">No items in this folder</p>
          </div>
        ) : (
          <div>
            {groupByDateBucket(items, (i) => i.createdAt).map((group) => (
              <div key={group.label}>
                <div className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur-sm px-3 py-1.5 border-b border-slate-200 text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
                  {group.label}
                </div>
                <div className="divide-y divide-slate-100">
                  {group.items.map((item) => {
              const isSelected = item.id === selectedItemId;

              const [company, contact] = (item.subtitle ?? "").split(" · ");
              const stageColor = STAGE_BADGE;
              const formattedValue = item.value
                ? item.value >= 1000
                  ? `$${(item.value / 1000).toFixed(0)}k`
                  : `$${item.value.toFixed(0)}`
                : null;

              return (
                <div
                  key={item.id}
                  onClick={() => onSelectItem(item.id)}
                  className={`group cursor-pointer w-full p-3 text-left transition-colors ${
                    isSelected
                      ? "bg-blue-50 border-l-2 border-l-blue-500"
                      : "hover:bg-slate-50 border-l-2 border-l-transparent"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ${isSelected ? "bg-blue-100 text-blue-600" : "bg-slate-100 text-slate-500"}`}>
                      <Briefcase className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-sm font-medium truncate ${isSelected ? "text-blue-900" : "text-slate-900"}`}>
                          {item.title}
                        </span>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {showActions && onResolveItem && <ItemActions itemId={item.id} onResolve={onResolveItem} />}
                          {formattedValue && (
                            <span className="text-xs font-semibold text-emerald-600">{formattedValue}</span>
                          )}
                        </div>
                      </div>
                      {company && <span className="text-xs text-slate-500 truncate block mt-0.5">{company}</span>}
                      {contact && <span className="text-xs text-slate-400 truncate block">{contact}</span>}
                      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                        {item.stage && (
                          <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${stageColor}`}>
                            {item.stage}
                          </span>
                        )}
                        {item.category === "Diamond" && <span title="Diamond" className="text-base leading-none">💎</span>}
                        {item.category === "Platinum" && <span title="Platinum" className="text-base leading-none">🔥</span>}
                        {item.service && <span className="text-[10px] text-slate-400 truncate">{item.service}</span>}
                      </div>
                    </div>
                  </div>
                </div>
              );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
