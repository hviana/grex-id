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
const ANONYMOUS_TOKEN_KEY = "core_anonymous_token";

interface AuthState {
  user: User | null;
  systemToken: string | null;
  anonymousToken: string | null;
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
 * Extracts Tenant from a JWT token. All values are real SurrealDB record IDs.
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
  if (!t?.systemId || !t?.companyId) {
    throw new Error("Invalid token: missing tenant fields");
  }
  return {
    systemId: t.systemId,
    companyId: t.companyId,
    systemSlug: t.systemSlug ?? "core",
    roles: t.roles ?? [],
    permissions: t.permissions ?? [],
  };
}

/**
 * Extracts full TenantClaims from a JWT token. All values are real SurrealDB record IDs.
 */
function extractClaims(token: string): TenantClaims | null {
  const payload = decodeJwtPayload(token);
  if (!payload) return null;
  const t = payload.tenant as Tenant;
  if (!t?.systemId || !t?.companyId) return null;
  return {
    systemId: t.systemId,
    companyId: t.companyId,
    systemSlug: t.systemSlug ?? "core",
    roles: t.roles ?? [],
    permissions: t.permissions ?? [],
    actorType: payload.actorType as TenantClaims["actorType"],
    actorId: payload.actorId as string,
    exchangeable: (payload.exchangeable as boolean) ?? false,
  };
}

/** Fetches the anonymous token from the public endpoint. */
async function fetchAnonymousToken(): Promise<string | null> {
  try {
    const res = await fetch("/api/public/anonymous-token");
    const json = await res.json();
    if (json.success && json.data?.token) {
      return json.data.token as string;
    }
    return null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    systemToken: null,
    anonymousToken: null,
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
        anonymousToken: null,
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
          anonymousToken: null,
          loading: false,
        });
      });
    } else {
      // No user token — fetch the anonymous token for public operations
      fetchAnonymousToken().then((anonToken) => {
        setState({
          user: null,
          systemToken: null,
          anonymousToken: anonToken,
          loading: false,
        });
      }).catch(() => {
        setState({
          user: null,
          systemToken: null,
          anonymousToken: null,
          loading: false,
        });
      });
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
        anonymousToken: null,
        loading: false,
      });

      return json.data;
    },
    [],
  );

  const logout = useCallback(() => {
    const currentToken = getCookie(TOKEN_COOKIE_NAME);
    if (currentToken) {
      fetch("/api/auth/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${currentToken}` },
      }).catch(() => {});
    }
    removeCookie(TOKEN_COOKIE_NAME);

    // Re-fetch anonymous token for public operations
    fetchAnonymousToken().then((anonToken) => {
      setState({
        user: null,
        systemToken: null,
        anonymousToken: anonToken,
        loading: false,
      });
    }).catch(() => {
      setState({
        user: null,
        systemToken: null,
        anonymousToken: null,
        loading: false,
      });
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

  /** The active bearer token — user token when logged in, anonymous token otherwise. */
  const activeToken = state.systemToken ?? state.anonymousToken;

  const tenant: Tenant = useMemo(() => {
    if (!activeToken) {
      // Still loading or anonymous token fetch failed — return a safe default
      return {
        systemId: "",
        companyId: "",
        systemSlug: "core",
        roles: [],
        permissions: [],
      };
    }
    return extractTenant(activeToken);
  }, [activeToken]);

  const claims: TenantClaims | null = useMemo(
    () => activeToken ? extractClaims(activeToken) : null,
    [activeToken],
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

/**
 * Returns the active bearer token for use in fetch wrappers.
 * User token when logged in, anonymous token when logged out.
 */
export function useBearerToken(): string | null {
  const { systemToken, anonymousToken } = useAuth();
  return systemToken ?? anonymousToken;
}
