import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { tokenStore } from "@/lib/tokenStore";
import { useAuthStore } from "@/store/authStore";
import { getMe } from "@/lib/api";

export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const login = useAuthStore((s) => s.login);
  const [error, setError] = useState("");

  useEffect(() => {
    const handleCallback = async () => {
      // Verify nonce
      const nonce = searchParams.get("nonce");
      const storedNonce = sessionStorage.getItem("sso_nonce");
      if (nonce && storedNonce && nonce !== storedNonce) {
        setError("Security verification failed. Please try again.");
        return;
      }
      sessionStorage.removeItem("sso_nonce");

      // Check for error from Microsoft
      const errorParam = searchParams.get("error");
      if (errorParam) {
        setError(searchParams.get("error_description") || "Authentication failed.");
        return;
      }

      // Parse response JSON from query param
      const responseStr = searchParams.get("response");
      if (!responseStr) {
        setError("No authentication response received.");
        return;
      }

      try {
        const response = JSON.parse(responseStr);
        if (response.status !== "OK" || !response.access_token) {
          setError("Authentication failed. Please try again.");
          return;
        }

        // Store tokens
        tokenStore.setTokens(response.access_token, response.refresh_token);

        // Fetch user profile
        const meRes = await getMe();
        login(meRes.data);

        navigate("/", { replace: true });
      } catch (err) {
        // Surface the actual error so users / ops can diagnose. Previously
        // this was a silent generic message that hid (e.g.) a /auth/me 500
        // due to a Pydantic validation error on a malformed Users row.
        // eslint-disable-next-line no-console
        console.error("[auth callback] Failed to process response:", err);
        const detail =
          // axios error
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (err as any)?.response?.data?.message ||
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (err as any)?.message ||
          "Unknown error";
        setError(`Failed to process authentication response: ${detail}`);
      }
    };

    handleCallback();
  }, [searchParams, login, navigate]);

  if (error) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-slate-50 px-4">
        <div className="text-center max-w-sm">
          <p className="text-red-600 text-sm mb-4">{error}</p>
          <button
            onClick={() => navigate("/login", { replace: true })}
            className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm hover:bg-slate-800 transition-colors"
          >
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh flex items-center justify-center bg-slate-50">
      <div className="flex items-center gap-3 text-slate-500 text-sm">
        <Loader2 className="w-5 h-5 animate-spin" />
        Signing you in...
      </div>
    </div>
  );
}
