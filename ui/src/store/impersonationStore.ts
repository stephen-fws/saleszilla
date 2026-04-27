import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Superadmin impersonation state.
 *
 * When `viewingAs` is set, the axios interceptor adds the
 * `X-Impersonate-User-Id` header on every request so the backend scopes data
 * to that user. The backend also rejects mutations server-side, so this
 * store is purely for UX (banner + button-disabling); it cannot be bypassed
 * by tampering with localStorage.
 *
 * Persisted as `sz-impersonation-storage` so reloading the page keeps the
 * admin in the chosen "view as" mode until they explicitly clear it.
 */
interface ImpersonationState {
  viewingAs: { userId: string; name: string; email: string } | null;
  setViewingAs: (target: { userId: string; name: string; email: string }) => void;
  clearViewingAs: () => void;
}

export const useImpersonationStore = create<ImpersonationState>()(
  persist(
    (set) => ({
      viewingAs: null,
      setViewingAs: (target) => set({ viewingAs: target }),
      clearViewingAs: () => set({ viewingAs: null }),
    }),
    {
      name: "sz-impersonation-storage",
    },
  ),
);
