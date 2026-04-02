/**
 * Token storage: access_token in sessionStorage, refresh_token in localStorage.
 */

const ACCESS_KEY = "sz_access_token";
const REFRESH_KEY = "sz_refresh_token";

export const tokenStore = {
  getAccessToken(): string | null {
    return sessionStorage.getItem(ACCESS_KEY);
  },
  setAccessToken(token: string): void {
    sessionStorage.setItem(ACCESS_KEY, token);
  },
  getRefreshToken(): string | null {
    return localStorage.getItem(REFRESH_KEY);
  },
  setRefreshToken(token: string): void {
    localStorage.setItem(REFRESH_KEY, token);
  },
  setTokens(access: string, refresh: string): void {
    sessionStorage.setItem(ACCESS_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
  },
  clearTokens(): void {
    sessionStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
  hasTokens(): boolean {
    return (
      !!sessionStorage.getItem(ACCESS_KEY) ||
      !!localStorage.getItem(REFRESH_KEY)
    );
  },
};
