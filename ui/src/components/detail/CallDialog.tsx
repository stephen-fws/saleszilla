/**
 * CallDialog — Twilio browser calling from the detail panel.
 *
 * Three visual states:
 *   1. Pre-call: modal overlay — select contact, edit phone, click "Call"
 *   2. In-call: compact bottom bar — user can browse all tabs while talking
 *   3. Post-call: slide-up card above bottom bar — notes + save
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Phone, PhoneOff, X, Loader2, User, Clock,
  Mic, MicOff, AlertCircle, CheckCircle, PhoneCall,
} from "lucide-react";
import { Device, Call } from "@twilio/voice-sdk";
import { getTwilioToken, getContactsForCall, createCallLog } from "@/lib/api";
import type { CallState, ContactForCall } from "@/types";

interface CallDialogProps {
  potentialId: string;
  potentialName: string | null;
  /**
   * Optional pre-selection. When the dialog is opened from a contact's phone
   * number (e.g. Account → Contacts tab), pass these so the right contact +
   * number show up immediately instead of the auto-picked primary.
   */
  initialContactId?: string;
  initialPhone?: string;
  onClose: (callSaved?: boolean) => void;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function CallDialog({ potentialId, potentialName, initialContactId, initialPhone, onClose }: CallDialogProps) {
  const [contacts, setContacts] = useState<ContactForCall[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [phoneNumber, setPhoneNumber] = useState("");

  const [callState, setCallState] = useState<CallState>("idle");
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const deviceRef = useRef<Device | null>(null);
  const callRef = useRef<Call | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const callSidRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getContactsForCall(potentialId)
      .then((cs) => {
        if (cancelled) return;
        setContacts(cs);
        // Prefer the explicit initialContactId (clicked-from-Account-Contacts
        // flow). Fall back to primary, then first.
        const initial = initialContactId
          ? cs.find((c) => c.contactId === initialContactId)
          : null;
        const chosen = initial ?? cs.find((c) => c.isPrimary) ?? cs[0];
        if (chosen) {
          setSelectedContactId(chosen.contactId);
          setPhoneNumber(initialPhone || chosen.phone || chosen.mobile || "");
        } else if (initialPhone) {
          // Contact wasn't in the loaded list — still let the user dial.
          setPhoneNumber(initialPhone);
        }
      })
      .catch(() => { if (!cancelled) setError("Failed to load contacts"); })
      .finally(() => { if (!cancelled) setLoadingContacts(false); });
    return () => { cancelled = true; };
    // initialContactId/initialPhone are read once when the dialog opens — no
    // need to re-run if they later change in a stale render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [potentialId]);

  useEffect(() => {
    const c = contacts.find((c) => c.contactId === selectedContactId);
    if (c) setPhoneNumber(c.phone || c.mobile || "");
  }, [selectedContactId, contacts]);

  useEffect(() => {
    if (callState === "in-progress") {
      timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
    } else {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [callState]);

  useEffect(() => {
    return () => {
      callRef.current?.disconnect();
      deviceRef.current?.destroy();
    };
  }, []);

  const initiateCall = useCallback(async () => {
    if (!phoneNumber.trim()) { setError("Enter a phone number"); return; }
    setError(null);
    setCallState("fetching-token");
    setDuration(0);
    try {
      const { token } = await getTwilioToken();
      const device = new Device(token, { logLevel: 1 });
      deviceRef.current = device;
      await device.register();
      setCallState("connecting");
      const call = await device.connect({ params: { To: phoneNumber.trim() } });
      callRef.current = call;
      callSidRef.current = call.parameters?.CallSid ?? null;
      const contact = contacts.find((c) => c.contactId === selectedContactId);
      try {
        await createCallLog({
          potentialId, contactId: selectedContactId, contactName: contact?.name ?? null,
          phoneNumber: phoneNumber.trim(), duration: 0, status: "in-progress",
          twilioCallSid: callSidRef.current,
        });
      } catch { /* retry on save */ }
      call.on("ringing", () => setCallState("ringing"));
      call.on("accept", () => {
        setCallState("in-progress");
        callSidRef.current = call.parameters?.CallSid ?? callSidRef.current;
      });
      call.on("disconnect", () => {
        setCallState("completed");
        callSidRef.current = call.parameters?.CallSid ?? callSidRef.current;
      });
      call.on("cancel", () => setCallState("completed"));
      call.on("error", (err) => { setError(err.message || "Call failed"); setCallState("failed"); });
    } catch (err: unknown) {
      setError((err as Error).message || "Failed to connect");
      setCallState("failed");
    }
  }, [phoneNumber, contacts, selectedContactId, potentialId]);

  const hangUp = useCallback(() => {
    callRef.current?.disconnect();
    setCallState("completed");
  }, []);

  const toggleMute = useCallback(() => {
    if (callRef.current) {
      const newMuted = !muted;
      callRef.current.mute(newMuted);
      setMuted(newMuted);
    }
  }, [muted]);

  const handleSaveAndClose = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    let saved = false;
    try {
      const contact = contacts.find((c) => c.contactId === selectedContactId);
      await createCallLog({
        potentialId, contactId: selectedContactId, contactName: contact?.name ?? null,
        phoneNumber, duration,
        status: callState === "completed" ? "completed" : "completed",
        twilioCallSid: callSidRef.current, notes: notes.trim() || null,
      });
      saved = true;
    } catch {
      setError("Failed to save call log.");
    } finally {
      setSaving(false);
      if (saved) onClose(true);
    }
  }, [potentialId, selectedContactId, contacts, phoneNumber, duration, callState, notes, onClose, saving]);

  const selectedContact = contacts.find((c) => c.contactId === selectedContactId);
  const isActive = callState === "connecting" || callState === "ringing" || callState === "in-progress";
  const isPostCall = callState === "completed" || callState === "failed";
  const isPreCall = !isActive && !isPostCall;

  // ── PRE-CALL: modal overlay ──────────────────────────────────────────────
  if (isPreCall) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => onClose(false)}>
        <div className="absolute inset-0 bg-black/30" />
        <div className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-slate-50">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center bg-blue-100">
                <Phone className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">Make a Call</h3>
                <p className="text-[11px] text-slate-500 truncate max-w-[250px]">{potentialName || "Unknown"}</p>
              </div>
            </div>
            <button onClick={() => onClose(false)} className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="px-5 py-4 space-y-4">
            {error && (
              <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-600">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />{error}
              </div>
            )}
            {loadingContacts ? (
              <div className="flex items-center gap-2 text-xs text-slate-400 py-4">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />Loading contacts…
              </div>
            ) : contacts.length === 0 ? (
              <p className="text-xs text-slate-500 py-2">No contacts with phone numbers found.</p>
            ) : (
              <div className="space-y-2">
                <label className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">Select Contact</label>
                <div className="space-y-1 max-h-40 overflow-y-auto scrollbar-thin">
                  {contacts.map((c) => (
                    <button
                      key={c.contactId}
                      onClick={() => setSelectedContactId(c.contactId)}
                      className={`w-full flex items-start gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                        c.contactId === selectedContactId ? "bg-blue-50 border border-blue-200" : "border border-transparent hover:bg-slate-50"
                      }`}
                    >
                      <User className="h-4 w-4 text-slate-400 shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-slate-800 truncate">
                          {c.name}{c.isPrimary && <span className="ml-1 text-[9px] text-blue-500 font-semibold">PRIMARY</span>}
                        </p>
                        <p className="text-[10px] text-slate-500 truncate">{c.title || c.email || "—"}</p>
                        <div className="flex gap-3 mt-0.5 text-[10px] text-slate-400">
                          {c.phone && <span>📞 {c.phone}</span>}
                          {c.mobile && <span>📱 {c.mobile}</span>}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div>
              <label className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider mb-1 block">Phone Number</label>
              <input
                type="tel" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="+1234567890"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50">
            <button onClick={() => onClose(false)} className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-md">Cancel</button>
            <button
              onClick={initiateCall}
              disabled={!phoneNumber.trim() || callState === "fetching-token"}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md disabled:opacity-50"
            >
              {callState === "fetching-token" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Phone className="h-3.5 w-3.5" />}
              Call
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── IN-CALL + POST-CALL: bottom bar (+ post-call card above it) ──────────
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 flex flex-col items-center pointer-events-none">
      {/* Post-call notes card — slides up above the bar */}
      {isPostCall && (
        <div className="w-full max-w-lg mx-auto mb-2 pointer-events-auto">
          <div className="rounded-xl bg-white border border-slate-200 shadow-2xl overflow-hidden mx-4">
            <div className="flex items-center gap-3 px-4 py-3 bg-slate-50 border-b border-slate-200">
              <CheckCircle className={`h-5 w-5 shrink-0 ${callState === "completed" ? "text-emerald-500" : "text-red-500"}`} />
              <div className="flex-1">
                <p className="text-sm font-medium text-slate-800">{callState === "completed" ? "Call completed" : "Call failed"}</p>
                <p className="text-xs text-slate-500">{selectedContact?.name || phoneNumber} · {formatDuration(duration)}</p>
              </div>
            </div>
            <div className="px-4 py-3 space-y-2">
              {error && (
                <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-600">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />{error}
                </div>
              )}
              <label className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider block">Call Notes (optional)</label>
              <textarea
                value={notes} onChange={(e) => setNotes(e.target.value)}
                placeholder="Key points discussed, follow-up items…"
                rows={3}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none"
              />
              <div className="flex justify-end">
                <button
                  onClick={handleSaveAndClose} disabled={saving}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
                  Save & Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bottom bar — always visible during/after call */}
      <div className="w-full bg-slate-900 border-t border-slate-700 pointer-events-auto">
        <div className="max-w-4xl mx-auto flex items-center justify-between px-4 py-2.5">
          {/* Left: status + contact */}
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
              isActive ? "bg-emerald-500/20" : "bg-slate-700"
            }`}>
              {isActive ? (
                <PhoneCall className="h-4 w-4 text-emerald-400 animate-pulse" />
              ) : (
                <Phone className="h-4 w-4 text-slate-400" />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-white truncate">
                {selectedContact?.name || phoneNumber}
              </p>
              <p className="text-[10px] text-slate-400">
                {callState === "connecting" ? "Connecting…"
                  : callState === "ringing" ? "Ringing…"
                  : callState === "in-progress" ? "In Progress"
                  : callState === "completed" ? "Call ended"
                  : "Failed"}
              </p>
            </div>
          </div>

          {/* Center: timer */}
          <div className="flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 text-slate-500" />
            <span className="text-lg font-mono font-bold text-white">{formatDuration(duration)}</span>
          </div>

          {/* Right: controls */}
          <div className="flex items-center gap-2">
            {isActive && (
              <>
                <button
                  onClick={toggleMute}
                  className={`rounded-full p-2 transition-colors ${
                    muted ? "bg-red-500/20 text-red-400" : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                  }`}
                  title={muted ? "Unmute" : "Mute"}
                >
                  {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                </button>
                <button
                  onClick={hangUp}
                  className="rounded-full p-2 bg-red-500 text-white hover:bg-red-600 transition-colors"
                  title="Hang up"
                >
                  <PhoneOff className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
