"use client";

import { useCallback, useEffect, useState } from "react";
import type { User } from "@/src/contracts/user";
import type { Tenant, TenantClaims } from "@/src/contracts/tenant";

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

/**
 * Decodes JWT payload without verification (frontend trusts the server-issued token).
 */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1];
    const decoded = atob(
      payload.replace(/-/g, "+").replace(/_/g, "/"),
    );
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

/**
 * Extracts Tenant from a JWT token.
 */
function extractTenant(token: string): Tenant {
  const payload = decodeJwtPayload(token);
  const t = payload?.tenant as
    | {
      systemId: string;
      companyId: string;
      systemSlug: string;
      roles: string[];
      permissions: string[];
    }
    | undefined;
  return {
    systemId: t?.systemId ?? "0",
    companyId: t?.companyId ?? "0",
    systemSlug: t?.systemSlug ?? "core",
    roles: t?.roles ?? [],
    permissions: t?.permissions ?? [],
  };
}

/**
 * Extracts full TenantClaims from a JWT token.
 */
function extractClaims(token: string): TenantClaims | null {
  const payload = decodeJwtPayload(token);
  if (!payload) return null;
  const t = payload.tenant as Tenant;
  return {
    systemId: t?.systemId ?? "0",
    companyId: t?.companyId ?? "0",
    systemSlug: t?.systemSlug ?? "core",
    roles: t?.roles ?? [],
    permissions: t?.permissions ?? [],
    actorType: (payload.actorType as TenantClaims["actorType"]) ?? "user",
    actorId: (payload.actorId as string) ?? "0",
    jti: (payload.jti as string) ?? "",
    exchangeable: (payload.exchangeable as boolean) ?? false,
  };
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

  /**
   * Exchanges the current token for a new one scoped to the given company+system.
   * This is the ONLY mechanism to change tenant on the frontend.
   */
  const exchangeTenant = useCallback(
    async (companyId: string, systemId: string) => {
      const currentToken = state.systemToken ?? getCookie(TOKEN_COOKIE_NAME);
      if (!currentToken) {
        throw new Error("No token available for exchange");
      }

      const res = await fetch("/api/auth/exchange", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${currentToken}`,
        },
        body: JSON.stringify({ companyId, systemId }),
      });
      const json = await res.json();

      if (!json.success) {
        throw new Error(
          json.error?.message ?? "auth.error.exchangeFailed",
        );
      }

      setCookie(TOKEN_COOKIE_NAME, json.data.systemToken);
      setState((s) => ({
        ...s,
        systemToken: json.data.systemToken,
      }));

      return json.data;
    },
    [state.systemToken],
  );

  // Derived properties from the JWT
  const tenant: Tenant = state.systemToken
    ? extractTenant(state.systemToken)
    : {
      systemId: "0",
      companyId: "0",
      systemSlug: "core",
      roles: [],
      permissions: [],
    };

  const claims: TenantClaims | null = state.systemToken
    ? extractClaims(state.systemToken)
    : null;

  return {
    ...state,
    tenant,
    claims,
    login,
    logout,
    refresh,
    exchangeTenant,
  };
}
