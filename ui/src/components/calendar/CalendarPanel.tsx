import { useCallback, useEffect, useRef, useState } from "react";
import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isAfter,
  isSameDay,
  isSameMonth,
  isToday,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
  subWeeks,
} from "date-fns";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Users,
  Video,
  X,
} from "lucide-react";
import { deleteCalendarEvent, getCalendarEvents } from "@/lib/api";
import type { CalendarAttendee, CalendarEvent as ApiCalendarEvent } from "@/lib/api";
import EventFormModal from "./EventFormModal";
import type { EventFormDefaults } from "./EventFormModal";

// ── Types ─────────────────────────────────────────────────────────────────────

type CalendarView = "month" | "week" | "day";

type EventColor = "blue" | "violet" | "emerald" | "amber" | "rose";

type UIEvent = {
  id: string;
  title: string;
  startAt: Date;
  endAt: Date;
  color: EventColor;
  attendees: CalendarAttendee[];
  location?: string;
  description?: string;
  isAllDay: boolean;
  isRecurring: boolean;
  onlineMeeting: boolean;
  onlineMeetingUrl?: string;
};

// ── Color system (ported from copilot) ───────────────────────────────────────

// All events use blue (Outlook-style). Other colors kept in EVENT_COLORS for potential future use.
// const COLOR_NAMES: EventColor[] = ["blue", "violet", "emerald", "amber", "rose"];

const EVENT_COLORS: Record<
  EventColor,
  { bg: string; border: string; text: string; dot: string }
> = {
  blue:    { bg: "bg-blue-500/15",    border: "border-blue-500/30",    text: "text-blue-700",    dot: "bg-blue-500" },
  violet:  { bg: "bg-violet-500/15",  border: "border-violet-500/30",  text: "text-violet-700",  dot: "bg-violet-500" },
  emerald: { bg: "bg-emerald-500/15", border: "border-emerald-500/30", text: "text-emerald-700", dot: "bg-emerald-500" },
  amber:   { bg: "bg-amber-500/15",   border: "border-amber-500/30",   text: "text-amber-700",   dot: "bg-amber-500" },
  rose:    { bg: "bg-rose-500/15",    border: "border-rose-500/30",    text: "text-rose-700",    dot: "bg-rose-500" },
};

const PAST_COLORS = { bg: "bg-slate-100", border: "border-slate-200", text: "text-slate-400", dot: "bg-slate-300" };

function colorForId(_id: string): EventColor {
  return "blue"; // Outlook-style: all events use the same blue
}

function getEventColors(ev: UIEvent) {
  if (ev.endAt < new Date()) return PAST_COLORS;
  return EVENT_COLORS[ev.color];
}

// ── API → UI event mapping ────────────────────────────────────────────────────

function mapEvent(e: ApiCalendarEvent): UIEvent | null {
  if (!e.start || !e.end) return null;
  return {
    id: e.id,
    title: e.subject,
    startAt: new Date(e.start),
    endAt: new Date(e.end),
    color: colorForId(e.id),
    attendees: e.attendees ?? [],
    location: e.location ?? undefined,
    description: e.bodyPreview ?? undefined,
    isAllDay: e.isAllDay,
    isRecurring: e.isRecurring,
    onlineMeeting: e.isOnlineMeeting,
    onlineMeetingUrl: e.onlineMeetingUrl ?? undefined,
  };
}

// ── Overlapping event layout (ported from copilot WeekView) ──────────────────

type PositionedEvent = UIEvent & { leftPct: number; widthPct: number };

function processOverlaps(events: UIEvent[]): PositionedEvent[] {
  if (!events.length) return [];

  type E = UIEvent & { col: number; cols: number };
  const sorted: E[] = events
    .map((e) => ({ ...e, col: 0, cols: 1 }))
    .sort((a, b) =>
      a.startAt.getTime() !== b.startAt.getTime()
        ? a.startAt.getTime() - b.startAt.getTime()
        : b.endAt.getTime() - a.endAt.getTime()
    );

  let group: E[] = [];
  let groupEnd = new Date(0);

  function settle(g: E[]) {
    if (!g.length) return;
    const cols: Date[] = [];
    for (const ev of g) {
      let placed = false;
      for (let i = 0; i < cols.length; i++) {
        if (ev.startAt >= cols[i]) { ev.col = i; cols[i] = ev.endAt; placed = true; break; }
      }
      if (!placed) { ev.col = cols.length; cols.push(ev.endAt); }
    }
    for (const ev of g) ev.cols = cols.length;
  }

  for (const ev of sorted) {
    if (ev.startAt >= groupEnd) { settle(group); group = [ev]; groupEnd = ev.endAt; }
    else { group.push(ev); if (ev.endAt > groupEnd) groupEnd = ev.endAt; }
  }
  settle(group);

  return sorted.map((ev) => ({
    ...ev,
    leftPct: (ev.col / ev.cols) * 100,
    widthPct: (1 / ev.cols) * 100,
  }));
}

// ── Time grid helpers ─────────────────────────────────────────────────────────

const HOUR_HEIGHT = 64; // px — matches copilot
const DAY_START = 0;
const DAY_END = 23;
const HOURS = Array.from({ length: DAY_END - DAY_START + 1 }, (_, i) => DAY_START + i);
const TOTAL_HEIGHT = HOURS.length * HOUR_HEIGHT;

function eventTop(startAt: Date): number {
  return (startAt.getHours() - DAY_START + startAt.getMinutes() / 60) * HOUR_HEIGHT;
}

function eventHeight(startAt: Date, endAt: Date): number {
  const mins = (endAt.getHours() - startAt.getHours()) * 60 + (endAt.getMinutes() - startAt.getMinutes());
  return Math.max((mins / 60) * HOUR_HEIGHT, 20);
}

function nowTop(): number {
  const n = new Date();
  return (n.getHours() - DAY_START + n.getMinutes() / 60) * HOUR_HEIGHT;
}

function fmtHour(h: number): string {
  if (h === 0) return "12 AM";
  if (h === 12) return "12 PM";
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}

// ── Event detail card (ported from copilot EventDetailCard) ──────────────────

function EventDetailCard({
  event,
  onClose,
  onEdit,
  onDelete,
}: {
  event: UIEvent;
  onClose: () => void;
  onEdit: (e: UIEvent) => void;
  onDelete: (id: string) => void;
}) {
  const c = getEventColors(event);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  async function handleDelete() {
    if (!confirm(`Delete "${event.title}"?`)) return;
    setDeleting(true);
    try {
      await deleteCalendarEvent(event.id);
      onDelete(event.id);
      onClose();
    } catch {
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px]" onClick={onClose} />
      <div className="fixed bottom-6 right-6 z-50 w-80 rounded-xl border border-slate-200 bg-white shadow-2xl">
        {/* Color accent bar */}
        <div className={`h-1 w-full rounded-t-xl ${c.dot}`} />

        <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3">
          <div className="flex items-start gap-2.5 min-w-0">
            <div className={`mt-0.5 h-3 w-3 shrink-0 rounded-full ${c.dot}`} />
            <h3 className="text-sm font-semibold leading-snug text-slate-900">{event.title}</h3>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {!event.isRecurring && (
              <>
                <button
                  onClick={() => onEdit(event)}
                  className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  title="Edit event"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-40"
                  title="Delete event"
                >
                  {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                </button>
              </>
            )}
            <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="space-y-2.5 px-4 pb-4">
          <div className="flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            <span className="text-xs text-slate-700">
              {format(event.startAt, "EEEE, MMMM d · h:mm a")}
              {" – "}
              {format(event.endAt, "h:mm a")}
              {event.isAllDay && <span className="ml-1 text-slate-400">(All day)</span>}
            </span>
          </div>

          {event.location && (
            <div className="flex items-center gap-2">
              <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              <span className="text-xs text-slate-700">{event.location}</span>
            </div>
          )}

          {event.attendees.length > 0 && (() => {
            const accepted = event.attendees.filter((a) => a.response === "accepted").length;
            const declined = event.attendees.filter((a) => a.response === "declined").length;
            const tentative = event.attendees.filter((a) => a.response === "tentativelyAccepted").length;
            const pending = event.attendees.length - accepted - declined - tentative;
            return (
              <div className="flex items-start gap-2">
                <Users className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                <div>
                  {/* Response summary */}
                  <div className="flex items-center gap-2 mb-1.5 text-[10px]">
                    <span className="text-slate-500">{event.attendees.length} invited</span>
                    {accepted > 0 && <span className="text-emerald-600">{accepted} accepted</span>}
                    {declined > 0 && <span className="text-red-500">{declined} declined</span>}
                    {tentative > 0 && <span className="text-amber-600">{tentative} tentative</span>}
                    {pending > 0 && <span className="text-slate-400">{pending} pending</span>}
                  </div>
                  {/* Attendee list */}
                  <div className="flex flex-wrap gap-1">
                    {event.attendees.map((a) => {
                      const responseColor = a.response === "accepted" ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                        : a.response === "declined" ? "border-red-300 bg-red-50 text-red-600 line-through"
                        : a.response === "tentativelyAccepted" ? "border-amber-300 bg-amber-50 text-amber-700"
                        : "border-slate-200 bg-slate-50 text-slate-600";
                      return (
                        <span
                          key={a.email}
                          title={`${a.email} — ${a.response === "tentativelyAccepted" ? "tentative" : a.response === "notResponded" ? "pending" : a.response}`}
                          className={`rounded-full border px-2 py-0.5 text-[10px] ${responseColor}`}
                        >
                          {a.name || a.email}
                        </span>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })()}
        </div>

        <div className="flex items-center gap-2 border-t border-slate-100 px-4 py-3">
          {event.onlineMeetingUrl ? (
            <a
              href={event.onlineMeetingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-semibold transition-opacity hover:opacity-80 ${c.bg} ${c.text}`}
            >
              <Video className="h-3 w-3" />
              Join Meeting
            </a>
          ) : (
            <span className="flex-1 rounded-md bg-slate-50 py-1.5 text-center text-xs text-slate-400">
              No meeting link
            </span>
          )}
        </div>
      </div>
    </>
  );
}

// ── Time grid (Week + Day) ─────────────────────────────────────────────────────

function TimeGrid({
  days,
  events,
  isLoading,
  onEventClick,
  onSlotClick,
}: {
  days: Date[];
  events: UIEvent[];
  isLoading: boolean;
  onEventClick: (e: UIEvent) => void;
  onSlotClick?: (day: Date, hour: number, minute: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [currentNowTop, setCurrentNowTop] = useState(nowTop);

  // Auto-scroll to current time on mount
  useEffect(() => {
    const top = nowTop();
    scrollRef.current?.scrollTo({ top: Math.max(0, top - 120), behavior: "smooth" });
  }, []);

  // Update red line every minute
  useEffect(() => {
    const id = setInterval(() => setCurrentNowTop(nowTop()), 60_000);
    return () => clearInterval(id);
  }, []);

  const cols = days.length;
  const allDayRows = days.map((d) => events.filter((e) => e.isAllDay && isSameDay(e.startAt, d)));
  const hasAllDay = allDayRows.some((r) => r.length > 0);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Sticky day headers */}
      <div
        className="z-10 shrink-0 border-b border-slate-200 bg-white"
        style={{ display: "grid", gridTemplateColumns: `56px repeat(${cols}, 1fr)` }}
      >
        <div className="border-r border-slate-100 py-2 text-center text-[10px] text-slate-400" />
        {days.map((day) => (
          <div
            key={day.toISOString()}
            className="flex flex-col items-center justify-center border-r border-slate-100 py-2 last:border-r-0"
          >
            <span className={`text-[10px] font-medium uppercase tracking-wider ${isToday(day) ? "text-blue-600" : "text-slate-400"}`}>
              {format(day, cols === 1 ? "EEEE" : "EEE")}
            </span>
            <span className={`mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold ${
              isToday(day) ? "bg-blue-600 text-white" : "text-slate-800"
            }`}>
              {format(day, "d")}
            </span>
          </div>
        ))}
      </div>

      {/* All-day row */}
      {hasAllDay && (
        <div
          className="shrink-0 border-b border-slate-200 bg-white"
          style={{ display: "grid", gridTemplateColumns: `56px repeat(${cols}, 1fr)` }}
        >
          <div className="border-r border-slate-100 flex items-center justify-end pr-2">
            <span className="text-[9px] text-slate-400 leading-tight">all<br />day</span>
          </div>
          {allDayRows.map((dayEvts, i) => (
            <div key={i} className="border-r border-slate-100 last:border-r-0 py-0.5 px-0.5 min-h-[26px]">
              {dayEvts.map((ev) => {
                const c = getEventColors(ev);
                return (
                  <button
                    key={ev.id}
                    onClick={() => onEventClick(ev)}
                    className={`w-full text-left text-[10px] font-medium rounded px-1.5 py-0.5 mb-0.5 truncate ${c.bg} ${c.text}`}
                  >
                    {ev.title}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {/* Scrollable time grid */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div
          className="relative"
          style={{
            display: "grid",
            gridTemplateColumns: `56px repeat(${cols}, 1fr)`,
            height: TOTAL_HEIGHT,
          }}
        >
          {/* Time labels */}
          <div className="relative border-r border-slate-100">
            {HOURS.map((h) => (
              <div
                key={h}
                className="absolute right-2 text-[10px] text-slate-400 -translate-y-2"
                style={{ top: (h - DAY_START) * HOUR_HEIGHT }}
              >
                {fmtHour(h)}
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map((day) => {
            const timedEvts = events.filter((e) => !e.isAllDay && isSameDay(e.startAt, day));
            const positioned = processOverlaps(timedEvts);
            const todayCol = isToday(day);

            function handleColumnClick(e: React.MouseEvent<HTMLDivElement>) {
              if (!onSlotClick) return;
              // Ignore if click originated on an event button
              if ((e.target as HTMLElement).closest("button")) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const relY = e.clientY - rect.top;
              const totalHours = relY / HOUR_HEIGHT + DAY_START;
              const hour = Math.floor(totalHours);
              const minute = Math.round((totalHours - hour) * 60 / 15) * 15;
              onSlotClick(day, Math.min(hour, 23), minute === 60 ? 0 : minute);
            }

            return (
              <div
                key={day.toISOString()}
                onClick={handleColumnClick}
                className={`relative border-r border-slate-100 last:border-r-0 cursor-pointer ${todayCol ? "bg-blue-50/30" : ""}`}
              >
                {/* Hour lines */}
                {HOURS.map((h) => (
                  <div key={h} className="absolute left-0 right-0 border-t border-slate-100"
                    style={{ top: (h - DAY_START) * HOUR_HEIGHT }} />
                ))}
                {/* Half-hour dashed */}
                {HOURS.map((h) => (
                  <div key={`h-${h}`} className="absolute left-0 right-0 border-t border-dashed border-slate-50"
                    style={{ top: (h - DAY_START + 0.5) * HOUR_HEIGHT }} />
                ))}

                {/* Current-time red line */}
                {todayCol && currentNowTop >= 0 && currentNowTop <= TOTAL_HEIGHT && (
                  <div className="absolute left-0 right-0 z-20 flex items-center" style={{ top: currentNowTop }}>
                    <div className="h-2 w-2 shrink-0 rounded-full bg-red-500" />
                    <div className="h-px flex-1 bg-red-500" />
                  </div>
                )}

                {/* Loading skeletons */}
                {isLoading && (
                  <>
                    <div className="absolute z-10 animate-pulse rounded-md bg-slate-200/60"
                      style={{ top: 9 * HOUR_HEIGHT, height: HOUR_HEIGHT * 0.75, left: 2, right: 2 }} />
                    <div className="absolute z-10 animate-pulse rounded-md bg-slate-200/40"
                      style={{ top: 11.5 * HOUR_HEIGHT, height: HOUR_HEIGHT * 0.5, left: 2, right: 2 }} />
                  </>
                )}

                {/* Events */}
                {!isLoading && positioned.map((ev) => {
                  const c = getEventColors(ev);
                  const top = eventTop(ev.startAt);
                  const height = eventHeight(ev.startAt, ev.endAt);
                  return (
                    <button
                      key={ev.id}
                      onClick={() => onEventClick(ev)}
                      style={{
                        top,
                        height,
                        left: `calc(${ev.leftPct}% + 2px)`,
                        width: `calc(${ev.widthPct}% - 4px)`,
                      }}
                      className={`absolute z-10 overflow-hidden rounded-md border px-1.5 py-1 text-left transition-opacity hover:opacity-90 cursor-pointer ${c.bg} ${c.border}`}
                    >
                      <p className={`truncate text-[11px] font-semibold leading-tight ${c.text}`}>{ev.title}</p>
                      {height >= 36 && (
                        <p className="truncate text-[10px] text-slate-500">
                          {format(ev.startAt, "h:mm")}–{format(ev.endAt, "h:mm a")}
                        </p>
                      )}
                      {height >= 52 && ev.location && (
                        <p className="truncate text-[10px] text-slate-400">{ev.location}</p>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Month view ────────────────────────────────────────────────────────────────

function MonthView({
  anchor,
  events,
  onEventClick,
  onDayDrillDown,
}: {
  anchor: Date;
  events: UIEvent[];
  onEventClick: (e: UIEvent) => void;
  onDayDrillDown: (d: Date) => void;
}) {
  const monthStart = startOfMonth(anchor);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 }); // Mon
  const gridEnd = endOfWeek(endOfMonth(anchor), { weekStartsOn: 1 });
  const cells = eachDayOfInterval({ start: gridStart, end: gridEnd });

  // Pad to 6 rows (42 cells)
  const padded = cells.length < 42
    ? [...cells, ...Array.from({ length: 42 - cells.length }, (_, i) => addDays(cells[cells.length - 1], i + 1))]
    : cells;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Weekday headers */}
      <div className="grid grid-cols-7 border-b border-slate-200 bg-white shrink-0">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((n) => (
          <div key={n} className="py-2 text-center text-[10px] font-medium uppercase tracking-wide text-slate-400 border-r border-slate-100 last:border-r-0">
            {n}
          </div>
        ))}
      </div>

      {/* 6×7 grid */}
      <div className="flex-1 grid grid-cols-7 overflow-hidden" style={{ gridTemplateRows: "repeat(6, 1fr)" }}>
        {padded.map((day, i) => {
          const inMonth = isSameMonth(day, anchor);
          const todayCell = isToday(day);
          const dayEvts = events.filter((e) => isSameDay(e.startAt, day));
          const maxShow = 3;
          const overflow = dayEvts.length - maxShow;

          return (
            <div
              key={i}
              className={`border-r border-b border-slate-100 last:border-r-0 p-1 flex flex-col min-h-0 overflow-hidden ${
                inMonth ? "bg-white" : "bg-slate-50/50"
              }`}
            >
              <button
                onClick={() => onDayDrillDown(day)}
                className={`self-start mb-0.5 text-[11px] font-semibold w-6 h-6 rounded-full flex items-center justify-center hover:bg-slate-100 transition-colors ${
                  todayCell ? "bg-blue-600 text-white hover:bg-blue-700" : inMonth ? "text-slate-700" : "text-slate-400"
                }`}
              >
                {format(day, "d")}
              </button>

              {dayEvts.slice(0, maxShow).map((ev) => {
                const c = getEventColors(ev);
                return (
                  <button
                    key={ev.id}
                    onClick={() => onEventClick(ev)}
                    className={`w-full text-left text-[10px] font-medium rounded px-1 py-0.5 mb-0.5 truncate hover:opacity-80 transition-opacity ${c.bg} ${c.text}`}
                  >
                    {!ev.isAllDay && (
                      <span className="opacity-70 mr-0.5">
                        {format(ev.startAt, "h:mma").replace(":00", "")}
                      </span>
                    )}
                    {ev.title}
                  </button>
                );
              })}

              {overflow > 0 && (
                <button
                  onClick={() => onDayDrillDown(day)}
                  className="text-left text-[10px] text-slate-500 hover:text-slate-700 pl-1"
                >
                  +{overflow} more
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Upcoming sidebar ─────────────────────────────────────────────────────────

function UpcomingSidebar({
  events,
  isLoading,
  onEventClick,
}: {
  events: UIEvent[];
  isLoading: boolean;
  onEventClick: (e: UIEvent) => void;
}) {
  const now = new Date();
  const todayStart = startOfDay(now);

  const todayEvents = events
    .filter((e) => !e.isAllDay && isSameDay(e.startAt, now))
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

  // Upcoming: future events not today, up to 8
  const upcomingEvents = events
    .filter((e) => !e.isAllDay && isAfter(e.startAt, startOfDay(addDays(todayStart, 1))))
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
    .slice(0, 8);

  function EventRow({ ev }: { ev: UIEvent }) {
    const c = getEventColors(ev);
    const isPast = ev.endAt < now;
    return (
      <button
        onClick={() => onEventClick(ev)}
        className={`w-full flex items-start gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-slate-50 ${isPast ? "opacity-50" : ""}`}
      >
        <div className={`mt-1 h-2 w-2 shrink-0 rounded-full ${c.dot}`} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-medium text-slate-800">{ev.title}</p>
          <div className="mt-0.5 flex items-center gap-1 text-[10px] text-slate-400">
            <Clock className="h-2.5 w-2.5 shrink-0" />
            <span>{format(ev.startAt, "h:mm")}–{format(ev.endAt, "h:mm a")}</span>
          </div>
          {ev.location && (
            <div className="mt-0.5 flex items-center gap-1 text-[10px] text-slate-400">
              <MapPin className="h-2.5 w-2.5 shrink-0" />
              <span className="truncate">{ev.location}</span>
            </div>
          )}
        </div>
        {ev.onlineMeetingUrl && (
          <Video className="h-3 w-3 shrink-0 mt-1 text-slate-400" />
        )}
      </button>
    );
  }

  function SkeletonRow() {
    return (
      <div className="flex items-start gap-2.5 px-2 py-2">
        <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-slate-200 animate-pulse" />
        <div className="flex-1 space-y-1.5">
          <div className="h-2.5 w-3/4 rounded bg-slate-200 animate-pulse" />
          <div className="h-2 w-1/2 rounded bg-slate-200 animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <aside className="w-56 shrink-0 border-r border-slate-200 bg-slate-50/40 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto p-3 space-y-4">

        {/* Today's meetings */}
        <div>
          <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Today
          </p>
          {isLoading ? (
            <><SkeletonRow /><SkeletonRow /></>
          ) : todayEvents.length === 0 ? (
            <p className="px-2 text-[11px] text-slate-400">No meetings today</p>
          ) : (
            todayEvents.map((ev) => <EventRow key={ev.id} ev={ev} />)
          )}
        </div>

        <div className="h-px bg-slate-200" />

        {/* Upcoming */}
        <div>
          <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Upcoming
          </p>
          {isLoading ? (
            <><SkeletonRow /><SkeletonRow /><SkeletonRow /></>
          ) : upcomingEvents.length === 0 ? (
            <p className="px-2 text-[11px] text-slate-400">No upcoming meetings</p>
          ) : (
            upcomingEvents.map((ev) => (
              <div key={ev.id}>
                {/* Date separator */}
                {upcomingEvents.indexOf(ev) === 0 ||
                  !isSameDay(ev.startAt, upcomingEvents[upcomingEvents.indexOf(ev) - 1].startAt) ? (
                  <p className="px-2 pt-1 pb-0.5 text-[10px] font-medium text-slate-500">
                    {isToday(ev.startAt)
                      ? "Today"
                      : isSameDay(ev.startAt, addDays(now, 1))
                      ? "Tomorrow"
                      : format(ev.startAt, "EEE, MMM d")}
                  </p>
                ) : null}
                <EventRow ev={ev} />
              </div>
            ))
          )}
        </div>
      </div>
    </aside>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

interface CalendarPanelProps {
  onClose: () => void;
}

export default function CalendarPanel({ onClose }: CalendarPanelProps) {
  const [view, setView] = useState<CalendarView>("week");
  // anchor = the focused day; each view derives its own range from this
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [apiEvents, setApiEvents] = useState<ApiCalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notConnected, setNotConnected] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<UIEvent | null>(null);
  const [formDefaults, setFormDefaults] = useState<EventFormDefaults | null>(null);

  const events: UIEvent[] = apiEvents.flatMap((e) => { const u = mapEvent(e); return u ? [u] : []; });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotConnected(false);
    try {
      setApiEvents(await getCalendarEvents(8));
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 424) setNotConnected(true);
      else setError("Failed to load calendar events.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Navigation ──────────────────────────────────────────────────────────────
  // anchor is always the true selected date; view switch never changes it

  function goToday() { setAnchor(new Date()); }

  function navigate(dir: -1 | 1) {
    if (view === "day") setAnchor((d) => (dir === 1 ? addDays(d, 1) : subDays(d, 1)));
    else if (view === "week") setAnchor((d) => (dir === 1 ? addWeeks(d, 1) : subWeeks(d, 1)));
    else setAnchor((d) => (dir === 1 ? addMonths(d, 1) : subMonths(d, 1)));
  }

  function drillToDay(day: Date) {
    setAnchor(day);
    setView("day");
  }

  function openNewEvent(day?: Date, hour?: number, minute?: number) {
    const base = day ?? anchor;
    const start = new Date(base);
    if (hour !== undefined) {
      start.setHours(hour, minute ?? 0, 0, 0);
    } else {
      // Default to current local time rounded up to next 30-min mark
      const now = new Date();
      const rounded = new Date(Math.ceil(now.getTime() / (30 * 60 * 1000)) * (30 * 60 * 1000));
      start.setHours(rounded.getHours(), rounded.getMinutes(), 0, 0);
    }
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    setFormDefaults({ date: base, startTime: start, endTime: end });
    setSelectedEvent(null);
  }

  function openEditEvent(ev: UIEvent) {
    setFormDefaults({
      eventId: ev.id,
      subject: ev.title,
      date: ev.startAt,
      startTime: ev.startAt,
      endTime: ev.endAt,
      location: ev.location,
      body: ev.description,
      isOnlineMeeting: ev.onlineMeeting,
      requiredAttendees: ev.attendees.filter((a) => a.type !== "optional"),
      optionalAttendees: ev.attendees.filter((a) => a.type === "optional"),
    });
    setSelectedEvent(null);
  }

  function handleEventSaved(saved: ApiCalendarEvent) {
    const mapped = mapEvent(saved);
    if (!mapped) return;
    setApiEvents((prev) => {
      const exists = prev.some((e) => e.id === saved.id);
      return exists
        ? prev.map((e) => (e.id === saved.id ? saved : e))
        : [...prev, saved];
    });
    setFormDefaults(null);
  }

  function handleEventDeleted(id: string) {
    setApiEvents((prev) => prev.filter((e) => e.id !== id));
  }

  // ── Derived display data ────────────────────────────────────────────────────

  const weekDays = eachDayOfInterval({
    start: startOfWeek(anchor, { weekStartsOn: 1 }),
    end: endOfWeek(anchor, { weekStartsOn: 1 }),
  });

  const gridDays = view === "day" ? [anchor] : weekDays;

  // ── Label ───────────────────────────────────────────────────────────────────

  let label = "";
  if (view === "day") {
    label = format(anchor, "EEEE, MMMM d, yyyy");
  } else if (view === "week") {
    const ws = weekDays[0];
    const we = weekDays[6];
    label = ws.getMonth() === we.getMonth()
      ? `${format(ws, "MMMM d")}–${format(we, "d, yyyy")}`
      : ws.getFullYear() === we.getFullYear()
      ? `${format(ws, "MMM d")} – ${format(we, "MMM d, yyyy")}`
      : `${format(ws, "MMM d, yyyy")} – ${format(we, "MMM d, yyyy")}`;
  } else {
    label = format(anchor, "MMMM yyyy");
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      {/* Header */}
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-200 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
          <span className="text-sm font-semibold text-slate-800 shrink-0">My Calendar</span>
        </div>

        {/* New event button */}
        <button
          onClick={() => openNewEvent()}
          className="shrink-0 flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          New Event
        </button>

        {/* Nav: prev · label · next · Today · Refresh */}
        <div className="shrink-0 flex items-center gap-1">
          <button onClick={() => navigate(-1)}
            className="h-7 w-7 flex items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 transition-colors">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[160px] text-center text-sm font-bold text-slate-900 px-1">{label}</span>
          <button onClick={() => navigate(1)}
            className="h-7 w-7 flex items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 transition-colors">
            <ChevronRight className="h-4 w-4" />
          </button>
          <button onClick={goToday}
            className="ml-1 px-2.5 py-1 text-xs font-medium rounded-md border border-slate-300 text-slate-600 hover:bg-slate-100 transition-colors">
            Today
          </button>
          <button onClick={load} disabled={loading}
            className="h-7 w-7 flex items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 disabled:opacity-40" title="Refresh">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {/* View switcher */}
        <div className="shrink-0 flex items-center rounded-md border border-slate-200 overflow-hidden text-xs font-medium">
          {(["month", "week", "day"] as CalendarView[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-1 capitalize border-r border-slate-200 last:border-r-0 transition-colors ${
                view === v ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      {loading && !apiEvents.length ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      ) : notConnected ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-8">
          <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center">
            <Calendar className="h-7 w-7 text-slate-400" />
          </div>
          <p className="text-sm font-medium text-slate-700">Microsoft account not connected</p>
          <p className="text-xs text-slate-500 max-w-xs">Connect your Microsoft 365 account to view your calendar events here.</p>
        </div>
      ) : error ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <p className="text-sm text-red-500">{error}</p>
          <button onClick={load} className="text-xs text-blue-600 hover:underline">Try again</button>
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          {/* Calendar main area */}
          {/* Left sidebar — upcoming meetings */}
          <UpcomingSidebar events={events} isLoading={loading} onEventClick={setSelectedEvent} />

          {/* Calendar main area */}
          <div className="flex-1 overflow-hidden">
            {view === "month" ? (
              <MonthView anchor={anchor} events={events} onEventClick={setSelectedEvent} onDayDrillDown={drillToDay} />
            ) : (
              <TimeGrid
                days={gridDays}
                events={events}
                isLoading={loading}
                onEventClick={setSelectedEvent}
                onSlotClick={(day, hour, minute) => openNewEvent(day, hour, minute)}
              />
            )}
          </div>
        </div>
      )}

      {selectedEvent && (
        <EventDetailCard
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
          onEdit={openEditEvent}
          onDelete={handleEventDeleted}
        />
      )}

      {formDefaults && (
        <EventFormModal
          defaults={formDefaults}
          onClose={() => setFormDefaults(null)}
          onSaved={handleEventSaved}
        />
      )}
    </div>
  );
}
