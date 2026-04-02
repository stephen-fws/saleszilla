import { Building2, Video, Clock } from "lucide-react";
import type { QueueItem } from "@/types";

function formatTime24to12(time24: string): string {
  if (!time24 || !time24.includes(":")) return time24 || "";
  const [h, m] = time24.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${(m ?? 0).toString().padStart(2, "0")} ${period}`;
}

function MeetingTypeBadge({ type }: { type: string }) {
  const styles: Record<string, string> = {
    demo: "bg-purple-100 text-purple-700",
    discovery: "bg-teal-100 text-teal-700",
    "follow-up": "bg-amber-100 text-amber-700",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium capitalize ${
        styles[type] || "bg-slate-100 text-slate-600"
      }`}
    >
      {type}
    </span>
  );
}

function parseDuration(preview: string): string | null {
  const match = preview.match(/Duration:\s*(\d+\s*min)/i);
  return match ? match[1] : null;
}

function SentByBadge({ sentBy }: { sentBy: string }) {
  const isAI = sentBy.toLowerCase() === "ai";
  return (
    <span
      className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
        isAI ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600"
      }`}
    >
      {isAI ? "Sent by AI" : "Edited by Human"}
    </span>
  );
}

interface QueuePanelProps {
  items: QueueItem[];
  selectedItemId: string | null;
  onSelectItem: (id: string) => void;
  folderType: string;
  loading?: boolean;
}

export default function QueuePanel({
  items,
  selectedItemId,
  onSelectItem,
  folderType,
  loading = false,
}: QueuePanelProps) {
  const isEmailsSent = folderType === "emails-sent";
  const isMeetingBriefs = folderType === "meeting-briefs";

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex h-14 items-center border-b border-slate-200 px-4">
        <span className="text-sm font-semibold text-slate-900">
          {isMeetingBriefs
            ? `${items.length} ${items.length === 1 ? "meeting" : "meetings"} today`
            : `${items.length} ${items.length === 1 ? "item" : "items"}`}
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
          <div className="divide-y divide-slate-100">
            {items.map((item) => {
              const isSelected = item.id === selectedItemId;

              if (isMeetingBriefs) {
                const displayTime = formatTime24to12(item.timeLabel);
                const duration = parseDuration(item.preview);
                const agendaText = item.preview.replace(/\s*Duration:\s*\d+\s*min\s*$/i, "");

                return (
                  <button
                    key={item.id}
                    onClick={() => onSelectItem(item.id)}
                    className={`w-full p-3 text-left transition-colors ${
                      isSelected
                        ? "bg-blue-50 border-l-2 border-l-blue-500"
                        : "hover:bg-slate-50 border-l-2 border-l-transparent"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ${
                          isSelected ? "bg-purple-100 text-purple-600" : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        <Video className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-base font-bold ${isSelected ? "text-blue-900" : "text-slate-900"}`}>
                            {displayTime}
                          </span>
                          {item.priority && <MeetingTypeBadge type={item.priority} />}
                          {duration && (
                            <span className="flex items-center gap-0.5 text-[10px] text-slate-400">
                              <Clock className="h-2.5 w-2.5" />
                              {duration}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5">
                          <span className={`text-sm font-medium ${isSelected ? "text-blue-800" : "text-slate-800"}`}>
                            {item.title}
                          </span>
                          <span className="text-xs text-slate-500 ml-1.5">{item.subtitle}</span>
                        </div>
                        <p className={`mt-1 text-xs line-clamp-2 ${isSelected ? "text-blue-700" : "text-slate-400"}`}>
                          {agendaText}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              }

              return (
                <button
                  key={item.id}
                  onClick={() => onSelectItem(item.id)}
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
                          {item.title}
                        </span>
                        <span className="flex-shrink-0 text-xs text-slate-400">{item.timeLabel}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-slate-500 truncate">{item.subtitle}</span>
                        {isEmailsSent && item.sentBy && <SentByBadge sentBy={item.sentBy} />}
                      </div>
                      <p className={`mt-1 text-xs line-clamp-2 ${isSelected ? "text-blue-700" : "text-slate-400"}`}>
                        {item.preview}
                      </p>
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
