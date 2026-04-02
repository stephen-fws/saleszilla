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

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,

      login: (user) => set({ user, isAuthenticated: true }),

      logout: () => {
        tokenStore.clearTokens();
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
