import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Mail, ArrowLeft, ShieldCheck, Loader2, KeyRound } from "lucide-react";
import { sendOTP, verifyOTP, getMe } from "@/lib/api";
import { tokenStore } from "@/lib/tokenStore";
import { useAuthStore } from "@/store/authStore";

const API_BASE = import.meta.env.VITE_API_BASE_URL as string;

type Step = "choose" | "email" | "otp";

export default function LoginPage() {
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);

  const [step, setStep] = useState<Step>("choose");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSSOLogin = () => {
    const callbackUrl = `${window.location.origin}/auth/callback`;
    const nonce = crypto.randomUUID();
    sessionStorage.setItem("sso_nonce", nonce);
    window.location.assign(
      `${API_BASE}/auth/sso/connect?callback_url=${encodeURIComponent(callbackUrl)}&nonce=${nonce}`
    );
  };

  const handleSendOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;

    const ALLOWED_DOMAINS = ["@flatworldsolutions.com", "@botworkflat.onmicrosoft.com"];
    if (!ALLOWED_DOMAINS.some((d) => trimmed.endsWith(d))) {
      setError("OTP login is only available for @flatworldsolutions.com or @botworkflat.onmicrosoft.com emails.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      await sendOTP(trimmed);
      setStep("otp");
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        "Failed to send code. Please try again.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOTP = async () => {
    if (otp.length < 6) return;
    setLoading(true);
    setError("");
    try {
      const res = await verifyOTP(email.trim().toLowerCase(), otp);
      tokenStore.setTokens(res.data.access_token, res.data.refresh_token);

      const meRes = await getMe();
      login(meRes.data);
      navigate("/", { replace: true });
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        "Invalid or expired code.";
      setError(msg);
      setOtp("");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-emerald-500 shadow-lg shadow-emerald-500/30 mb-4">
            <ShieldCheck className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            <span className="text-emerald-600">Sale</span>
            <span className="text-amber-500">zilla</span>
          </h1>
          <p className="text-sm text-slate-500 mt-1">AI-powered Sales CRM</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-xl shadow-black/5 border border-slate-200 p-7">

          {/* ── Step: Choose method ── */}
          {step === "choose" && (
            <>
              <h2 className="text-lg font-semibold text-slate-900 mb-1">Sign in</h2>
              <p className="text-sm text-slate-500 mb-6">
                Choose how you'd like to sign in
              </p>

              {/* Microsoft SSO */}
              <button
                onClick={handleSSOLogin}
                className="w-full py-2.5 rounded-lg border border-slate-300 bg-white text-sm font-medium
                           text-slate-700 hover:bg-slate-50 transition-colors
                           flex items-center justify-center gap-3"
              >
                <MicrosoftIcon />
                Continue with Microsoft
              </button>

              {/* Divider */}
              <div className="flex items-center gap-3 my-5">
                <div className="flex-1 h-px bg-slate-200" />
                <span className="text-xs text-slate-400">or</span>
                <div className="flex-1 h-px bg-slate-200" />
              </div>

              {/* OTP — disabled */}
              <button
                disabled
                className="w-full py-2.5 rounded-lg bg-slate-900 text-white text-sm font-medium
                           disabled:opacity-30 disabled:cursor-not-allowed
                           flex items-center justify-center gap-2"
              >
                <Mail className="w-4 h-4" />
                Sign in with Email Code
              </button>

              <p className="text-[10px] text-slate-400 text-center mt-2">
                OTP login disabled — use Microsoft sign-in above
              </p>
            </>
          )}

          {/* ── Step: Enter email ── */}
          {step === "email" && (
            <>
              <button
                onClick={() => { setStep("choose"); setError(""); }}
                className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 mb-4 -ml-1"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back
              </button>

              <h2 className="text-lg font-semibold text-slate-900 mb-1">Email Login</h2>
              <p className="text-sm text-slate-500 mb-6">
                Enter your Flatworld Solutions email
              </p>

              <form onSubmit={handleSendOTP}>
                <div className="relative mb-4">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="email"
                    placeholder="you@flatworldsolutions.com or @botworkflat.onmicrosoft.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={loading}
                    autoFocus
                    className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-slate-300 bg-white
                               text-sm text-slate-900 placeholder:text-slate-400 outline-none
                               focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20
                               disabled:opacity-50 transition-all"
                  />
                </div>

                {error && (
                  <p className="text-xs text-red-600 mb-3">{error}</p>
                )}

                <button
                  type="submit"
                  disabled
                  title="OTP login is disabled — use Microsoft SSO below"
                  className="w-full py-2.5 rounded-lg bg-slate-900 text-white text-sm font-medium
                             disabled:opacity-30 disabled:cursor-not-allowed
                             transition-colors flex items-center justify-center gap-2"
                >
                  Send Login Code
                </button>
                <p className="text-[10px] text-slate-400 text-center mt-1.5">OTP login disabled — use Microsoft sign-in below</p>
              </form>
            </>
          )}

          {/* ── Step: Enter OTP ── */}
          {step === "otp" && (
            <>
              <button
                onClick={() => { setStep("email"); setOtp(""); setError(""); }}
                className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 mb-4 -ml-1"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back
              </button>

              <h2 className="text-lg font-semibold text-slate-900 mb-1">Check your email</h2>
              <p className="text-sm text-slate-500 mb-6">
                We sent a 6-digit code to{" "}
                <span className="font-medium text-slate-700">{email}</span>
              </p>

              <div className="relative mb-4">
                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="Enter 6-digit code"
                  value={otp}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                    setOtp(v);
                    setError("");
                  }}
                  disabled={loading}
                  autoFocus
                  maxLength={6}
                  className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-slate-300 bg-white
                             text-sm text-slate-900 tracking-[0.3em] font-semibold
                             placeholder:text-slate-400 placeholder:tracking-normal placeholder:font-normal
                             outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20
                             disabled:opacity-50 transition-all"
                />
              </div>

              {error && (
                <p className="text-xs text-red-600 mb-3 text-center">{error}</p>
              )}

              <button
                onClick={handleVerifyOTP}
                disabled={loading || otp.length < 6}
                className="w-full py-2.5 rounded-lg bg-slate-900 text-white text-sm font-medium
                           hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed
                           transition-colors flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Verify & Sign In"}
              </button>

              <button
                onClick={handleSendOTP}
                disabled={loading}
                className="w-full mt-3 py-2 text-xs text-slate-500 hover:text-slate-700 transition-colors"
              >
                Didn't receive it? Resend code
              </button>
            </>
          )}
        </div>

        {/* Pre-consent info */}
        <p className="text-[11px] text-slate-400 text-center mt-5 leading-relaxed px-2">
          By signing in, you agree that Salezilla may request access to
          send emails and read your calendar on your behalf via Microsoft 365.
        </p>
      </div>
    </div>
  );
}

/** Microsoft four-square logo */
function MicrosoftIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 21 21" fill="none">
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}
