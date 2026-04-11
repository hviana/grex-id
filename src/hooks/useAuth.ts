"use client";

import { useCallback, useEffect, useState } from "react";
import type { User } from "@/src/contracts/user";
const TOKEN_COOKIE_NAME = "core_token";
const SURREAL_TOKEN_COOKIE_NAME = "core_surreal_token";

interface AuthState {
  user: User | null;
  systemToken: string | null;
  surrealToken: string | null;
  loading: boolean;
}

function getCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match?.[1];
}

function setCookie(name: string, value: string, days: number = 7): void {
  if (typeof document === "undefined") return;
  const expires = new Date(Date.now() + days * 86400000).toUTCString();
  document.cookie =
    `${name}=${value}; expires=${expires}; path=/; SameSite=Lax`;
}

function removeCookie(name: string): void {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    systemToken: null,
    surrealToken: null,
    loading: true,
  });

  useEffect(() => {
    const token = getCookie(TOKEN_COOKIE_NAME);
    if (token) {
      refresh(token).catch(() => {
        setState({
          user: null,
          systemToken: null,
          surrealToken: null,
          loading: false,
        });
      });
    } else {
      setState((s) => ({ ...s, loading: false }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(
    async (
      email: string,
      password: string,
      stayLoggedIn?: boolean,
      twoFactorCode?: string,
    ) => {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, stayLoggedIn, twoFactorCode }),
      });
      const json = await res.json();

      if (!json.success) {
        throw new Error(json.error?.message ?? "auth.login.error.invalid");
      }

      const days = stayLoggedIn ? 7 : 1;
      setCookie(TOKEN_COOKIE_NAME, json.data.systemToken, days);
      if (json.data.surrealToken) {
        setCookie(SURREAL_TOKEN_COOKIE_NAME, json.data.surrealToken, days);
      }

      setState({
        user: json.data.user,
        systemToken: json.data.systemToken,
        surrealToken: json.data.surrealToken,
        loading: false,
      });

      return json.data;
    },
    [],
  );

  const logout = useCallback(() => {
    removeCookie(TOKEN_COOKIE_NAME);
    removeCookie(SURREAL_TOKEN_COOKIE_NAME);
    setState({
      user: null,
      systemToken: null,
      surrealToken: null,
      loading: false,
    });
  }, []);

  const refresh = useCallback(async (token?: string) => {
    const systemToken = token ?? getCookie(TOKEN_COOKIE_NAME);
    if (!systemToken) return;

    const res = await fetch("/api/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ systemToken }),
    });
    const json = await res.json();

    if (!json.success) {
      removeCookie(TOKEN_COOKIE_NAME);
      removeCookie(SURREAL_TOKEN_COOKIE_NAME);
      setState({
        user: null,
        systemToken: null,
        surrealToken: null,
        loading: false,
      });
      return;
    }

    setCookie(TOKEN_COOKIE_NAME, json.data.systemToken);
    if (json.data.surrealToken) {
      setCookie(SURREAL_TOKEN_COOKIE_NAME, json.data.surrealToken);
    }

    setState((s) => ({
      ...s,
      user: json.data.user ?? s.user,
      systemToken: json.data.systemToken,
      surrealToken: json.data.surrealToken,
      loading: false,
    }));
  }, []);

  return { ...state, login, logout, refresh };
}
