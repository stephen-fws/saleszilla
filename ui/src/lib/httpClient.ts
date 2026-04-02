/**
 * Axios HTTP client with JWT interceptors.
 * - publicApi: no auth, for login/OTP
 * - protectedApi: auto-attaches Bearer, refreshes on 401
 */

import axios, { type AxiosInstance, type AxiosResponse } from "axios";
import { tokenStore } from "./tokenStore";

const BASE_URL = import.meta.env.VITE_API_BASE_URL as string;

let isRefreshing = false;
let refreshSubscribers: Array<(token: string) => void> = [];

function onTokenRefreshed(newToken: string) {
  refreshSubscribers.forEach((cb) => cb(newToken));
  refreshSubscribers = [];
}

function addRefreshSubscriber(cb: (token: string) => void) {
  refreshSubscribers.push(cb);
}

function forceLogout() {
  tokenStore.clearTokens();
  import("@/store/authStore").then(({ useAuthStore }) => {
    useAuthStore.getState().logout();
  });
  if (window.location.pathname !== "/login") {
    window.location.assign("/login");
  }
}

function createInstance(isProtected = false): AxiosInstance {
  const instance = axios.create({
    baseURL: BASE_URL,
    headers: { "Content-Type": "application/json" },
  });

  if (isProtected) {
    instance.interceptors.request.use((config) => {
      const token = tokenStore.getAccessToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });

    instance.interceptors.response.use(
      (response: AxiosResponse) => response,
      async (error) => {
        const originalRequest = error.config;

        if (error.response?.status === 401 && !originalRequest._retry) {
          if (isRefreshing) {
            return new Promise((resolve) => {
              addRefreshSubscriber((newToken: string) => {
                originalRequest.headers.Authorization = `Bearer ${newToken}`;
                resolve(axios(originalRequest));
              });
            });
          }

          originalRequest._retry = true;
          isRefreshing = true;

          try {
            const refreshToken = tokenStore.getRefreshToken();
            const res = await axios.get(`${BASE_URL}/auth/refresh`, {
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${refreshToken}`,
              },
            });

            const newAccessToken: string = res.data.data.access_token;
            tokenStore.setAccessToken(newAccessToken);
            onTokenRefreshed(newAccessToken);

            originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
            return axios(originalRequest);
          } catch {
            refreshSubscribers = [];
            forceLogout();
            return Promise.reject(error);
          } finally {
            isRefreshing = false;
          }
        }

        return Promise.reject(error);
      },
    );
  }

  return instance;
}

export const publicApi = createInstance(false);
export const protectedApi = createInstance(true);
