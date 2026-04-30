import { useEffect, useState } from "react";
import { X, Save, Loader2, CheckCircle2, AlertCircle, Clock, Globe2, MailCheck, Phone } from "lucide-react";
import { getUserSettings, updateUserSettings } from "@/lib/api";
import { COMMON_TIMEZONES } from "@/types";
import type { UserSettings } from "@/types";

interface SettingsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

const DEFAULT_SETTINGS: UserSettings = {
  emailSignature: "",
  workingHoursStart: "09:00",
  workingHoursEnd: "18:00",
  timezone: "Asia/Kolkata",
  twilioNumber: null,
  twilioDefaultNumber: null,
};

const E164_RE = /^\+[1-9]\d{1,14}$/;

export default function SettingsDrawer({ isOpen, onClose }: SettingsDrawerProps) {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [initial, setInitial] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setError(null);
    setSaved(false);
    getUserSettings()
      .then((s) => {
        const normalized: UserSettings = {
          emailSignature: s.emailSignature ?? "",
          workingHoursStart: s.workingHoursStart ?? DEFAULT_SETTINGS.workingHoursStart,
          workingHoursEnd: s.workingHoursEnd ?? DEFAULT_SETTINGS.workingHoursEnd,
          timezone: s.timezone ?? DEFAULT_SETTINGS.timezone,
          twilioNumber: s.twilioNumber ?? null,
          twilioDefaultNumber: s.twilioDefaultNumber ?? null,
        };
        setSettings(normalized);
        setInitial(normalized);
      })
      .catch((err) => setError((err as Error).message || "Failed to load settings"))
      .finally(() => setLoading(false));
  }, [isOpen]);

  const dirty =
    settings.emailSignature !== initial.emailSignature ||
    settings.workingHoursStart !== initial.workingHoursStart ||
    settings.workingHoursEnd !== initial.workingHoursEnd ||
    settings.timezone !== initial.timezone ||
    (settings.twilioNumber ?? "") !== (initial.twilioNumber ?? "");

  const hoursInvalid =
    settings.workingHoursStart &&
    settings.workingHoursEnd &&
    settings.workingHoursStart >= settings.workingHoursEnd;

  // Empty is allowed (clears the field). Non-empty must be E.164. Trim
  // first — pasted values often carry whitespace/zero-width chars that
  // would silently fail the regex without this.
  const trimmedTwilio = (settings.twilioNumber ?? "").trim();
  const twilioInvalid = !!trimmedTwilio && !E164_RE.test(trimmedTwilio);

  async function handleSave() {
    if (!dirty || hoursInvalid || twilioInvalid) return;
    setSaving(true);
    setError(null);
    try {
      // Send empty string when the user cleared the field — backend wipes the
      // column and the app falls back to the org default.
      const payload: Partial<UserSettings> = { ...settings, twilioNumber: trimmedTwilio };
      // Empty string explicitly clears the column server-side.
      if (!payload.twilioNumber) payload.twilioNumber = "";
      const updated = await updateUserSettings(payload);
      const normalized: UserSettings = {
        emailSignature: updated.emailSignature ?? "",
        workingHoursStart: updated.workingHoursStart ?? DEFAULT_SETTINGS.workingHoursStart,
        workingHoursEnd: updated.workingHoursEnd ?? DEFAULT_SETTINGS.workingHoursEnd,
        timezone: updated.timezone ?? DEFAULT_SETTINGS.timezone,
        twilioNumber: updated.twilioNumber ?? null,
        twilioDefaultNumber: updated.twilioDefaultNumber ?? null,
      };
      setSettings(normalized);
      setInitial(normalized);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const detail = (err as any)?.response?.data?.message || (err as Error).message || "Failed to save settings";
      setError(detail);
    } finally {
      setSaving(false);
    }
  }

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/30 transition-opacity"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed right-0 top-0 z-50 h-full w-full max-w-md bg-white shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 flex-shrink-0">
          <h2 className="text-sm font-semibold text-slate-900">Settings</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto scrollbar-thin px-5 py-5 space-y-6">
          {loading ? (
            <div className="flex items-center gap-2 text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-xs">Loading…</span>
            </div>
          ) : (
            <>
              {/* Working hours */}
              <section>
                <div className="flex items-center gap-1.5 mb-2">
                  <Clock className="h-3.5 w-3.5 text-slate-400" />
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Working Hours</h3>
                </div>
                <p className="text-xs text-slate-500 mb-3">
                  Follow-up emails and AI actions are only triggered during these hours in your timezone.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">Start</label>
                    <input
                      type="time"
                      value={settings.workingHoursStart ?? ""}
                      onChange={(e) => setSettings((s) => ({ ...s, workingHoursStart: e.target.value }))}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">End</label>
                    <input
                      type="time"
                      value={settings.workingHoursEnd ?? ""}
                      onChange={(e) => setSettings((s) => ({ ...s, workingHoursEnd: e.target.value }))}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                    />
                  </div>
                </div>
                {hoursInvalid && (
                  <p className="mt-1.5 text-[11px] text-red-600">End time must be after start time.</p>
                )}
              </section>

              {/* Timezone */}
              <section>
                <div className="flex items-center gap-1.5 mb-2">
                  <Globe2 className="h-3.5 w-3.5 text-slate-400" />
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Timezone</h3>
                </div>
                <select
                  value={settings.timezone ?? ""}
                  onChange={(e) => setSettings((s) => ({ ...s, timezone: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                >
                  {COMMON_TIMEZONES.map((tz) => (
                    <option key={tz.value} value={tz.value}>{tz.label}</option>
                  ))}
                </select>
              </section>

              {/* Twilio (calling) number */}
              <section>
                <div className="flex items-center gap-1.5 mb-2">
                  <Phone className="h-3.5 w-3.5 text-slate-400" />
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Calling Number</h3>
                </div>
                <p className="text-xs text-slate-500 mb-3">
                  Your personal Twilio number used as caller ID for outbound calls.
                  Leave empty to use the org default
                  {settings.twilioDefaultNumber ? (
                    <> (<span className="font-mono">{settings.twilioDefaultNumber}</span>)</>
                  ) : null}.
                  Must be in E.164 format (e.g. <span className="font-mono">+14155551234</span>) and provisioned on the org's Twilio account.
                </p>
                <input
                  type="tel"
                  value={settings.twilioNumber ?? ""}
                  onChange={(e) => {
                    setSettings((s) => ({ ...s, twilioNumber: e.target.value || null }));
                    // Clear any stale server-side error so the user gets
                    // immediate feedback that their edit is being accepted.
                    if (error) setError(null);
                  }}
                  placeholder={settings.twilioDefaultNumber ?? "+14155551234"}
                  className={`w-full rounded-lg border px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 ${
                    twilioInvalid ? "border-red-300" : "border-slate-200"
                  }`}
                />
                {twilioInvalid && (
                  <p className="mt-1.5 text-[11px] text-red-600">Must be E.164 (start with + and country code).</p>
                )}
              </section>

              {/* Email signature */}
              <section>
                <div className="flex items-center gap-1.5 mb-2">
                  <MailCheck className="h-3.5 w-3.5 text-slate-400" />
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Email Signature</h3>
                </div>
                <p className="text-xs text-slate-500 mb-3">
                  Appended to emails you send through Salezilla. Plain text or simple HTML.
                </p>
                <textarea
                  value={settings.emailSignature ?? ""}
                  onChange={(e) => setSettings((s) => ({ ...s, emailSignature: e.target.value }))}
                  placeholder="Best regards,&#10;Your Name&#10;Sales Team · Flatworld Solutions"
                  rows={6}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 resize-y font-mono text-xs"
                />
              </section>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-5 py-3 bg-slate-50 border-t border-slate-200 flex-shrink-0">
          {error ? (
            <div className="flex items-center gap-1.5 text-xs text-red-600">
              <AlertCircle className="h-3.5 w-3.5" />
              <span>{error}</span>
            </div>
          ) : saved ? (
            <div className="flex items-center gap-1.5 text-xs text-emerald-600 font-medium">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>Saved</span>
            </div>
          ) : dirty ? (
            <span className="text-xs text-slate-500">You have unsaved changes</span>
          ) : (
            <span className="text-xs text-slate-400">All changes saved</span>
          )}

          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={onClose}
              disabled={saving}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
            >
              Close
            </button>
            <button
              onClick={handleSave}
              disabled={!dirty || saving || !!hoursInvalid || twilioInvalid}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              {saving ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
