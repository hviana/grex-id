"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { User } from "@/src/contracts/user";
import type { Tenant, TenantClaims } from "@/src/contracts/tenant";
import { getCookie, removeCookie, setCookie } from "@/src/lib/cookies";

const TOKEN_COOKIE_NAME = "core_token";

interface AuthState {
  user: User | null;
  systemToken: string | null;
  loading: boolean;
}

interface AuthContextValue extends AuthState {
  tenant: Tenant;
  claims: TenantClaims | null;
  login: (
    identifier: string,
    password: string,
    stayLoggedIn?: boolean,
    twoFactorCode?: string,
  ) => Promise<{ user: User; systemToken: string }>;
  logout: () => void;
  refresh: (token?: string) => Promise<void>;
  exchangeTenant: (
    companyId: string,
    systemId: string,
  ) => Promise<{ token: string }>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

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
    exchangeable: (payload.exchangeable as boolean) ?? false,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    systemToken: null,
    loading: true,
  });

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
      setState({
        user: null,
        systemToken: null,
        loading: false,
      });
      return;
    }

    setCookie(TOKEN_COOKIE_NAME, json.data.systemToken);

    setState((s) => ({
      ...s,
      user: json.data.user ?? s.user,
      systemToken: json.data.systemToken,
      loading: false,
    }));
  }, []);

  useEffect(() => {
    const token = getCookie(TOKEN_COOKIE_NAME);
    if (token) {
      refresh(token).catch(() => {
        setState({
          user: null,
          systemToken: null,
          loading: false,
        });
      });
    } else {
      setState((s) => ({ ...s, loading: false }));
    }
  }, [refresh]);

  const login = useCallback(
    async (
      identifier: string,
      password: string,
      stayLoggedIn?: boolean,
      twoFactorCode?: string,
    ) => {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier,
          password,
          stayLoggedIn,
          twoFactorCode,
        }),
      });
      const json = await res.json();

      if (!json.success) {
        throw new Error(json.error?.message ?? "auth.login.error.invalid");
      }

      const days = stayLoggedIn ? 7 : 1;
      setCookie(TOKEN_COOKIE_NAME, json.data.systemToken, days);

      setState({
        user: json.data.user,
        systemToken: json.data.systemToken,
        loading: false,
      });

      return json.data;
    },
    [],
  );

  const logout = useCallback(() => {
    const currentToken = getCookie(TOKEN_COOKIE_NAME);
    if (currentToken) {
      // Fire-and-forget: server removes the user from the actor-validity
      // cache (§12.8). Failure does not block the client-side teardown.
      fetch("/api/auth/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${currentToken}` },
      }).catch(() => {});
    }
    removeCookie(TOKEN_COOKIE_NAME);
    setState({
      user: null,
      systemToken: null,
      loading: false,
    });
  }, []);

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

  const tenant: Tenant = useMemo(
    () =>
      state.systemToken ? extractTenant(state.systemToken) : {
        systemId: "0",
        companyId: "0",
        systemSlug: "core",
        roles: [],
        permissions: [],
      },
    [state.systemToken],
  );

  const claims: TenantClaims | null = useMemo(
    () => state.systemToken ? extractClaims(state.systemToken) : null,
    [state.systemToken],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      tenant,
      claims,
      login,
      logout,
      refresh,
      exchangeTenant,
    }),
    [state, tenant, claims, login, logout, refresh, exchangeTenant],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
