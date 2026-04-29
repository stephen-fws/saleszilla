import { create } from "zustand";
import { persist } from "zustand/middleware";
import { tokenStore } from "@/lib/tokenStore";
import type { User } from "@/types";

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  login: (user: User) => void;
  logout: () => void;
  setUser: (user: User) => void;
  setMicrosoftConnected: (msEmail: string) => void;
  setMicrosoftDisconnected: () => void;
}

// Clear any impersonation state from a previous user's session. Without this,
// when superadmin A logs out and user B logs in on the same browser, B's
// requests still carry A's `X-Impersonate-User-Id` header — backend then
// rejects B (non-superadmin trying to impersonate) and login appears broken.
function clearImpersonationState() {
  try {
    localStorage.removeItem("sz-impersonation-storage");
  } catch { /* ignore */ }
  // Also reset the in-memory store if it's already loaded.
  import("./impersonationStore").then(({ useImpersonationStore }) => {
    useImpersonationStore.getState().clearViewingAs();
  }).catch(() => {});
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,

      login: (user) => {
        clearImpersonationState();
        set({ user, isAuthenticated: true });
      },

      logout: () => {
        tokenStore.clearTokens();
        clearImpersonationState();
        set({ user: null, isAuthenticated: false });
      },

      setUser: (user) => set({ user, isAuthenticated: true }),

      setMicrosoftConnected: (msEmail) =>
        set((state) => ({
          user: state.user
            ? { ...state.user, is_ms_connected: true, ms_email: msEmail }
            : null,
        })),

      setMicrosoftDisconnected: () =>
        set((state) => ({
          user: state.user
            ? { ...state.user, is_ms_connected: false, ms_email: null }
            : null,
        })),
    }),
    {
      name: "sz-auth-storage",
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    },
  ),
);
