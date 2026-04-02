import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { Loader2, MapPin, Plus, UserCheck, Users, Video, X } from "lucide-react";
import { createCalendarEvent, searchPeople, updateCalendarEvent } from "@/lib/api";
import type { CalendarAttendee, CalendarEvent as ApiEvent, PersonResult } from "@/lib/api";

// ── Helpers ───────────────────────────────────────────────────────────────────

function toLocalISODate(d: Date): string { return format(d, "yyyy-MM-dd"); }
function toLocalISOTime(d: Date): string { return format(d, "HH:mm"); }
function buildISO(date: string, time: string): string { return `${date}T${time}:00`; }
function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/** Round up to the next 30-minute boundary in local time. */
function roundUpTo30(d: Date): Date {
  const ms = 30 * 60 * 1000;
  return new Date(Math.ceil(d.getTime() / ms) * ms);
}

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EventFormDefaults {
  eventId?: string;
  subject?: string;
  date?: Date;
  startTime?: Date;
  endTime?: Date;
  location?: string;
  body?: string;
  isOnlineMeeting?: boolean;
  requiredAttendees?: CalendarAttendee[];
  optionalAttendees?: CalendarAttendee[];
}

interface EventFormModalProps {
  defaults: EventFormDefaults;
  onClose: () => void;
  onSaved: (event: ApiEvent) => void;
}

// ── Attendee tag input with people search ─────────────────────────────────────

function AttendeeInput({
  label,
  icon: Icon,
  emails,
  onChange,
}: {
  label: string;
  icon: typeof Users;
  emails: string[];
  onChange: (emails: string[]) => void;
}) {
  const [inputVal, setInputVal] = useState("");
  const [suggestions, setSuggestions] = useState<PersonResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Search people when input changes
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = inputVal.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      setActiveIdx(-1);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const results = await searchPeople(trimmed);
        // Filter out already-added emails
        setSuggestions(results.filter((r) => !emails.includes(r.email)));
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
        setActiveIdx(-1);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [inputVal, emails]);

  function addEmail(raw: string) {
    const parts = raw.split(/[,;\s]+/).map((s) => s.trim()).filter(isValidEmail);
    if (!parts.length) return;
    const next = [...new Set([...emails, ...parts])];
    onChange(next);
    setInputVal("");
    setSuggestions([]);
    setActiveIdx(-1);
  }

  function addSuggestion(person: PersonResult) {
    if (!emails.includes(person.email)) {
      onChange([...emails, person.email]);
    }
    setInputVal("");
    setSuggestions([]);
    setActiveIdx(-1);
    inputRef.current?.focus();
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, -1));
        return;
      }
      if (e.key === "Enter" && activeIdx >= 0) {
        e.preventDefault();
        addSuggestion(suggestions[activeIdx]);
        return;
      }
      if (e.key === "Escape") {
        setSuggestions([]);
        setActiveIdx(-1);
        return;
      }
    }
    if (["Enter", ",", ";", "Tab"].includes(e.key)) {
      e.preventDefault();
      addEmail(inputVal);
    } else if (e.key === "Backspace" && !inputVal && emails.length) {
      onChange(emails.slice(0, -1));
    }
  }

  function handleBlur(e: React.FocusEvent) {
    // Don't close if clicking inside dropdown
    if (dropdownRef.current?.contains(e.relatedTarget as Node)) return;
    setTimeout(() => {
      setSuggestions([]);
      setActiveIdx(-1);
    }, 150);
    addEmail(inputVal);
  }

  function remove(email: string) { onChange(emails.filter((e) => e !== email)); }

  const showDropdown = suggestions.length > 0 || loading;

  return (
    <div className="relative">
      <div className="flex items-center gap-2 mb-1">
        <Icon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</span>
      </div>
      <div
        className="flex flex-wrap gap-1.5 rounded-md border border-slate-200 px-2.5 py-2 min-h-[36px] cursor-text focus-within:border-blue-400 transition-colors"
        onClick={() => inputRef.current?.focus()}
      >
        {emails.map((email) => (
          <span
            key={email}
            className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-700"
          >
            {email}
            <button
              type="button"
              onMouseDown={(e) => { e.preventDefault(); remove(email); }}
              className="text-slate-400 hover:text-slate-600"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}
        <div className="relative flex-1 min-w-[160px]">
          <input
            ref={inputRef}
            type="text"
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            onKeyDown={handleKey}
            onBlur={handleBlur}
            placeholder={emails.length === 0 ? "Name or email…" : ""}
            className="w-full text-xs text-slate-700 placeholder-slate-400 outline-none bg-transparent"
          />
        </div>
      </div>

      {/* Suggestions dropdown */}
      {showDropdown && (
        <div
          ref={dropdownRef}
          className="absolute left-0 right-0 z-10 mt-1 rounded-md border border-slate-200 bg-white shadow-lg overflow-hidden"
        >
          {loading && (
            <div className="flex items-center gap-2 px-3 py-2.5 text-xs text-slate-400">
              <Loader2 className="h-3 w-3 animate-spin" />
              Searching…
            </div>
          )}
          {!loading && suggestions.map((person, idx) => (
            <button
              key={person.email}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); addSuggestion(person); }}
              className={`w-full flex items-start gap-2.5 px-3 py-2 text-left transition-colors ${
                idx === activeIdx ? "bg-blue-50" : "hover:bg-slate-50"
              }`}
            >
              <div className="h-6 w-6 rounded-full bg-blue-100 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-[10px] font-semibold text-blue-600">
                  {person.name ? person.name[0].toUpperCase() : "?"}
                </span>
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-800 truncate">{person.name || person.email}</p>
                {person.name && (
                  <p className="text-[10px] text-slate-400 truncate">
                    {person.email}{person.jobTitle ? ` · ${person.jobTitle}` : ""}
                  </p>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function EventFormModal({ defaults, onClose, onSaved }: EventFormModalProps) {
  const isEditing = !!defaults.eventId;

  const now = new Date();
  const defaultDate = defaults.date ?? now;
  const defaultStart = defaults.startTime ?? roundUpTo30(now);
  const defaultEnd = defaults.endTime ?? new Date(defaultStart.getTime() + 60 * 60 * 1000);
  const crossesMidnight = defaultEnd.getDate() !== defaultStart.getDate();

  const [subject, setSubject] = useState(defaults.subject ?? "");
  const [date, setDate] = useState(toLocalISODate(defaultDate));
  const [startTime, setStartTime] = useState(toLocalISOTime(defaultStart));
  const [endTime, setEndTime] = useState(toLocalISOTime(defaultEnd));
  // endDate is normally same as date; advances +1 when end time < start time (crosses midnight)
  const [endDate, setEndDate] = useState(
    crossesMidnight ? toLocalISODate(defaultEnd) : toLocalISODate(defaultDate)
  );
  const [location, setLocation] = useState(defaults.location ?? "");
  const [isOnlineMeeting, setIsOnlineMeeting] = useState(defaults.isOnlineMeeting ?? false);
  const [requiredAttendees, setRequiredAttendees] = useState<string[]>(
    (defaults.requiredAttendees ?? []).map((a) => a.email)
  );
  const [optionalAttendees, setOptionalAttendees] = useState<string[]>(
    (defaults.optionalAttendees ?? []).map((a) => a.email)
  );
  const [showOptional, setShowOptional] = useState(
    (defaults.optionalAttendees ?? []).length > 0
  );
  const [body, setBody] = useState(defaults.body ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subjectRef = useRef<HTMLInputElement>(null);
  useEffect(() => { subjectRef.current?.focus(); }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  function syncEndDate(newStart: string, newEnd: string, baseDate: string) {
    // If end time is before start time, end falls on the next day
    if (timeToMinutes(newEnd) <= timeToMinutes(newStart)) {
      const next = new Date(baseDate);
      next.setDate(next.getDate() + 1);
      setEndDate(toLocalISODate(next));
    } else {
      setEndDate(baseDate);
    }
  }

  function handleStartChange(val: string) {
    setStartTime(val);
    const [sh, sm] = val.split(":").map(Number);
    const newEnd = `${String(sh + 1 > 23 ? 0 : sh + 1).padStart(2, "0")}:${String(sm).padStart(2, "0")}`;
    setEndTime(newEnd);
    syncEndDate(val, newEnd, date);
  }

  function handleEndTimeChange(val: string) {
    setEndTime(val);
    syncEndDate(startTime, val, date);
  }

  function handleDateChange(val: string) {
    setDate(val);
    syncEndDate(startTime, endTime, val);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!subject.trim()) { setError("Title is required."); return; }

    setError(null);
    setSaving(true);
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const payload = {
        subject: subject.trim(),
        start: buildISO(date, startTime),
        end: buildISO(endDate, endTime),
        timezone,
        location: location.trim() || undefined,
        body: body.trim() || undefined,
        isOnlineMeeting,
        requiredAttendees,
        optionalAttendees,
      };

      const saved = isEditing
        ? await updateCalendarEvent(defaults.eventId!, payload)
        : await createCalendarEvent(payload);
      onSaved(saved);
    } catch {
      setError("Failed to save event. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const isMeeting = isOnlineMeeting || requiredAttendees.length > 0 || optionalAttendees.length > 0;

  return (
    <>
      <div className="fixed inset-0 z-[55] bg-black/30 backdrop-blur-[1px]" onClick={onClose} />

      <div className="fixed left-1/2 top-1/2 z-[60] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border border-slate-200 bg-white shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 shrink-0">
          <h2 className="text-sm font-semibold text-slate-800">
            {isEditing ? "Edit Event" : isMeeting ? "New Meeting" : "New Event"}
          </h2>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable form body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {/* Title */}
          <input
            ref={subjectRef}
            type="text"
            placeholder="Add title"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full border-0 border-b border-slate-200 pb-2 text-base font-medium text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none transition-colors"
          />

          {/* Date + times */}
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="block text-[10px] font-medium uppercase tracking-wide text-slate-400 mb-1">Date</label>
              <input type="date" value={date} onChange={(e) => handleDateChange(e.target.value)}
                className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 focus:border-blue-400 focus:outline-none" />
            </div>
            <div className="w-24">
              <label className="block text-[10px] font-medium uppercase tracking-wide text-slate-400 mb-1">Start</label>
              <input type="time" value={startTime} onChange={(e) => handleStartChange(e.target.value)}
                className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 focus:border-blue-400 focus:outline-none" />
            </div>
            <div className="w-24">
              <label className="block text-[10px] font-medium uppercase tracking-wide text-slate-400 mb-1">
                End{endDate !== date && <span className="ml-1 text-blue-500">+1 day</span>}
              </label>
              <input type="time" value={endTime} onChange={(e) => handleEndTimeChange(e.target.value)}
                className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 focus:border-blue-400 focus:outline-none" />
            </div>
          </div>

          {/* Required attendees */}
          <AttendeeInput
            label="Required attendees"
            icon={Users}
            emails={requiredAttendees}
            onChange={setRequiredAttendees}
          />

          {/* Optional attendees toggle / input */}
          {showOptional ? (
            <AttendeeInput
              label="Optional attendees"
              icon={UserCheck}
              emails={optionalAttendees}
              onChange={setOptionalAttendees}
            />
          ) : (
            <button
              type="button"
              onClick={() => setShowOptional(true)}
              className="flex items-center gap-1.5 text-[11px] text-blue-600 hover:text-blue-700"
            >
              <Plus className="h-3 w-3" />
              Add optional attendees
            </button>
          )}

          {/* Location */}
          <div className="flex items-center gap-2.5">
            <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            <input type="text" placeholder="Add location" value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="flex-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 placeholder-slate-400 focus:border-blue-400 focus:outline-none" />
          </div>

          {/* Teams meeting toggle */}
          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <Video className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            <div>
              <span className="text-xs text-slate-700 font-medium">Teams meeting</span>
              <p className="text-[10px] text-slate-400">A meeting link will be auto-generated</p>
            </div>
            <div className="ml-auto">
              <button
                type="button"
                onClick={() => setIsOnlineMeeting((v) => !v)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${isOnlineMeeting ? "bg-blue-600" : "bg-slate-200"}`}
              >
                <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${isOnlineMeeting ? "translate-x-4" : "translate-x-0.5"}`} />
              </button>
            </div>
          </label>

          {/* Teams badge when enabled */}
          {isOnlineMeeting && (
            <div className="flex items-center gap-2 rounded-lg bg-blue-50 border border-blue-100 px-3 py-2">
              <Video className="h-3.5 w-3.5 text-blue-500 shrink-0" />
              <span className="text-[11px] text-blue-700">
                A Teams meeting link will be included in the invite
              </span>
            </div>
          )}

          {/* Body / description */}
          <textarea
            placeholder="Add description (optional)"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-slate-200 px-2.5 py-2 text-xs text-slate-700 placeholder-slate-400 focus:border-blue-400 focus:outline-none resize-none"
          />

          {error && <p className="text-xs text-red-500">{error}</p>}
        </form>

        {/* Footer actions */}
        <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 shrink-0">
          {requiredAttendees.length > 0 && (
            <span className="text-[11px] text-slate-500">
              {requiredAttendees.length + optionalAttendees.length} invitee{requiredAttendees.length + optionalAttendees.length !== 1 ? "s" : ""}
            </span>
          )}
          <div className="flex gap-2 ml-auto">
            <button type="button" onClick={onClose}
              className="rounded-md border border-slate-200 px-4 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors">
              Cancel
            </button>
            <button
              onClick={handleSubmit as unknown as React.MouseEventHandler}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60 transition-colors"
            >
              {saving && <Loader2 className="h-3 w-3 animate-spin" />}
              {isEditing ? "Save changes" : isMeeting ? "Send invite" : "Create event"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
