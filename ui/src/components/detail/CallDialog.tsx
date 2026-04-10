/**
 * CallDialog — modal for browser-based Twilio calling from the detail panel.
 *
 * Three states:
 *   1. Pre-call: select contact, edit phone, click "Call"
 *   2. In-call: live status + duration timer + hang up
 *   3. Post-call: add notes, save & close
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
  onClose: (callSaved?: boolean) => void;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function CallDialog({ potentialId, potentialName, onClose }: CallDialogProps) {
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

  // Load contacts on mount
  useEffect(() => {
    let cancelled = false;
    getContactsForCall(potentialId)
      .then((cs) => {
        if (cancelled) return;
        setContacts(cs);
        // Auto-select the primary contact
        const primary = cs.find((c) => c.isPrimary) ?? cs[0];
        if (primary) {
          setSelectedContactId(primary.contactId);
          setPhoneNumber(primary.phone || primary.mobile || "");
        }
      })
      .catch(() => { if (!cancelled) setError("Failed to load contacts"); })
      .finally(() => { if (!cancelled) setLoadingContacts(false); });
    return () => { cancelled = true; };
  }, [potentialId]);

  // Auto-fill phone when contact selection changes
  useEffect(() => {
    const c = contacts.find((c) => c.contactId === selectedContactId);
    if (c) setPhoneNumber(c.phone || c.mobile || "");
  }, [selectedContactId, contacts]);

  // Duration timer
  useEffect(() => {
    if (callState === "in-progress") {
      timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
    } else {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [callState]);

  // Cleanup device on unmount
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
      // Get Twilio token
      const { token } = await getTwilioToken();

      // Initialize device
      const device = new Device(token, { logLevel: 1 });
      deviceRef.current = device;

      await device.register();
      setCallState("connecting");

      // Make the call
      const call = await device.connect({ params: { To: phoneNumber.trim() } });
      callRef.current = call;
      callSidRef.current = call.parameters?.CallSid ?? null;

      // Create the call log immediately so the recording webhook can find it
      // (Twilio's recording webhook often arrives before the user clicks "Save & Close")
      const contact = contacts.find((c) => c.contactId === selectedContactId);
      try {
        await createCallLog({
          potentialId,
          contactId: selectedContactId,
          contactName: contact?.name ?? null,
          phoneNumber: phoneNumber.trim(),
          duration: 0,
          status: "in-progress",
          twilioCallSid: callSidRef.current,
        });
      } catch {
        // Non-fatal — we'll try again on Save & Close
        console.warn("Early call log creation failed, will retry on save");
      }

      call.on("ringing", () => setCallState("ringing"));
      call.on("accept", () => {
        setCallState("in-progress");
        // Update callSid if it changed after accept
        callSidRef.current = call.parameters?.CallSid ?? callSidRef.current;
      });
      call.on("disconnect", () => {
        setCallState("completed");
        callSidRef.current = call.parameters?.CallSid ?? callSidRef.current;
      });
      call.on("cancel", () => setCallState("completed"));
      call.on("error", (err) => {
        setError(err.message || "Call failed");
        setCallState("failed");
      });
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
    if (saving) return; // prevent double-invocation
    setSaving(true);
    let saved = false;
    try {
      const contact = contacts.find((c) => c.contactId === selectedContactId);
      await createCallLog({
        potentialId,
        contactId: selectedContactId,
        contactName: contact?.name ?? null,
        phoneNumber,
        duration,
        status: callState === "completed" ? "completed" : callState === "failed" ? "failed" : "completed",
        twilioCallSid: callSidRef.current,
        notes: notes.trim() || null,
      });
      saved = true;
    } catch (err) {
      console.error("Failed to save call log:", err);
      setError("Failed to save call log. Please try again.");
    } finally {
      setSaving(false);
      if (saved) onClose(true);
    }
  }, [potentialId, selectedContactId, contacts, phoneNumber, duration, callState, notes, onClose]);

  const selectedContact = contacts.find((c) => c.contactId === selectedContactId);
  const isActive = callState === "connecting" || callState === "ringing" || callState === "in-progress";
  const isPostCall = callState === "completed" || callState === "failed";

  // Block backdrop click during/after call — force user to use Save & Close or hang up
  const handleBackdropClick = useCallback(() => {
    if (saving) return; // already saving — ignore duplicate clicks
    if (isActive) return; // during call — ignore
    if (isPostCall) {
      handleSaveAndClose();
      return;
    }
    onClose(false);
  }, [saving, isActive, isPostCall, handleSaveAndClose, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={handleBackdropClick}>
      <div className="absolute inset-0 bg-black/30" />
      <div
        className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
              isActive ? "bg-emerald-100" : isPostCall ? "bg-slate-100" : "bg-blue-100"
            }`}>
              {isActive ? (
                <PhoneCall className="h-5 w-5 text-emerald-600 animate-pulse" />
              ) : (
                <Phone className="h-5 w-5 text-blue-600" />
              )}
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                {isActive ? "Call in Progress" : isPostCall ? "Call Ended" : "Make a Call"}
              </h3>
              <p className="text-[11px] text-slate-500 truncate max-w-[250px]">
                {potentialName || "Unknown Potential"}
              </p>
            </div>
          </div>
          {!isActive && !isPostCall && (
            <button onClick={() => onClose(false)} className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-600">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {error}
            </div>
          )}

          {/* Pre-call: contact selection + phone input */}
          {!isActive && !isPostCall && (
            <>
              {loadingContacts ? (
                <div className="flex items-center gap-2 text-xs text-slate-400 py-4">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading contacts…
                </div>
              ) : contacts.length === 0 ? (
                <p className="text-xs text-slate-500 py-2">No contacts with phone numbers found for this potential.</p>
              ) : (
                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">Select Contact</label>
                  <div className="space-y-1 max-h-40 overflow-y-auto scrollbar-thin">
                    {contacts.map((c) => (
                      <button
                        key={c.contactId}
                        onClick={() => setSelectedContactId(c.contactId)}
                        className={`w-full flex items-start gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                          c.contactId === selectedContactId
                            ? "bg-blue-50 border border-blue-200"
                            : "border border-transparent hover:bg-slate-50"
                        }`}
                      >
                        <User className="h-4 w-4 text-slate-400 shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-slate-800 truncate">
                            {c.name}
                            {c.isPrimary && <span className="ml-1 text-[9px] text-blue-500 font-semibold">PRIMARY</span>}
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

              {/* Editable phone number */}
              <div>
                <label className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider mb-1 block">
                  Phone Number
                </label>
                <input
                  type="tel"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="+1234567890"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
              </div>
            </>
          )}

          {/* In-call: status + timer + controls */}
          {isActive && (
            <div className="flex flex-col items-center py-4 space-y-4">
              <div className="text-center">
                <p className="text-sm font-medium text-slate-800">{selectedContact?.name || phoneNumber}</p>
                <p className="text-xs text-slate-500 capitalize mt-0.5">
                  {callState === "connecting" ? "Connecting…" : callState === "ringing" ? "Ringing…" : "In Progress"}
                </p>
              </div>

              {/* Timer */}
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-slate-400" />
                <span className="text-2xl font-mono font-bold text-slate-900">{formatDuration(duration)}</span>
              </div>

              {/* Controls */}
              <div className="flex items-center gap-4">
                <button
                  onClick={toggleMute}
                  className={`rounded-full p-3 transition-colors ${
                    muted ? "bg-red-100 text-red-600" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                  title={muted ? "Unmute" : "Mute"}
                >
                  {muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                </button>
                <button
                  onClick={hangUp}
                  className="rounded-full p-3 bg-red-500 text-white hover:bg-red-600 transition-colors"
                  title="Hang up"
                >
                  <PhoneOff className="h-5 w-5" />
                </button>
              </div>
            </div>
          )}

          {/* Post-call: summary + notes */}
          {isPostCall && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 rounded-lg bg-slate-50 border border-slate-200 px-4 py-3">
                <CheckCircle className={`h-5 w-5 shrink-0 ${callState === "completed" ? "text-emerald-500" : "text-red-500"}`} />
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-800">
                    {callState === "completed" ? "Call completed" : "Call failed"}
                  </p>
                  <p className="text-xs text-slate-500">
                    {selectedContact?.name || phoneNumber} · {formatDuration(duration)}
                  </p>
                </div>
              </div>

              <div>
                <label className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider mb-1 block">
                  Call Notes (optional)
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Key points discussed, follow-up items…"
                  rows={3}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none"
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50">
          {!isActive && !isPostCall && (
            <>
              <button
                onClick={() => onClose(false)}
                className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={initiateCall}
                disabled={!phoneNumber.trim() || callState === "fetching-token"}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {callState === "fetching-token" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Phone className="h-3.5 w-3.5" />
                )}
                Call
              </button>
            </>
          )}

          {isPostCall && (
            <button
              onClick={handleSaveAndClose}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
              Save & Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
