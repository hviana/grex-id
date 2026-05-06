"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "@/src/frontend-registry";
import type { UserResolved } from "@/src/contracts/high-level/user";
import type { Tenant } from "@/src/contracts/tenant";
import type {
  AuthClaims,
  AuthResponse,
  TenantContext,
  TenantContextValue,
} from "@/src/contracts/high-level/tenant-context";
import type { Company } from "@/src/contracts/company";
import type { System } from "@/src/contracts/system";
import type { PublicSystemInfo } from "@/src/contracts/high-level/systems";
import type {
  ClientTranslations,
  SupportedLocale,
} from "@/src/contracts/high-level/i18n";
import {
  defaultLocale as fallbackLocale,
  supportedLocales,
  t as translate,
} from "@/src/i18n";
import { getCookie, removeCookie, setCookie } from "@/src/lib/cookies";

const TOKEN_COOKIE_NAME = "core_token";
const LOCALE_COOKIE_NAME = "core_locale";
const COMPANY_COOKIE = "core_company";
const SYSTEM_COOKIE = "core_system";

const EMPTY_TRANSLATIONS: ClientTranslations = {
  systems: {},
  frameworks: {},
};

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const decoded = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

function extractTenant(token: string): Tenant {
  const payload = decodeJwtPayload(token);
  if (!payload) throw new Error("Invalid token: missing payload");
  const t = payload.tenant as
    | { id: string; systemId?: string; companyId?: string; actorId?: string }
    | undefined;
  if (!t?.id) throw new Error("Invalid token: missing tenant id");
  return {
    id: t.id,
    systemId: t.systemId,
    companyId: t.companyId,
    actorId: t.actorId ?? (payload.actorId as string | undefined),
  };
}

async function fetchAnonymousToken(): Promise<string | null> {
  try {
    const res = await fetch("/api/public/anonymous-token");
    const json = await res.json();
    return json.success && json.data?.token
      ? (json.data.token as string)
      : null;
  } catch {
    return null;
  }
}

function resolveBrowserLocale(): SupportedLocale | undefined {
  if (typeof navigator === "undefined" || !navigator.languages) {
    return undefined;
  }
  const locales = supportedLocales as readonly string[];
  for (const tag of navigator.languages) {
    if (locales.includes(tag)) return tag as SupportedLocale;
  }
  for (const tag of navigator.languages) {
    const prefix = tag.split("-")[0];
    for (const supported of locales) {
      if (supported.split("-")[0] === prefix) {
        return supported as SupportedLocale;
      }
    }
  }
  return undefined;
}

function resolveInitialLocale(defaultLocale?: string): SupportedLocale {
  const valid = supportedLocales as readonly string[];
  const stored = getCookie(LOCALE_COOKIE_NAME);
  if (stored && valid.includes(stored)) return stored as SupportedLocale;
  const browser = resolveBrowserLocale();
  if (browser) return browser;
  if (defaultLocale && valid.includes(defaultLocale)) {
    return defaultLocale as SupportedLocale;
  }
  return fallbackLocale;
}

const TenantContext = createContext<TenantContextValue | null>(null);

export function TenantProvider(
  { children, defaultLocale }: { children: ReactNode; defaultLocale?: string },
) {
  const [user, setUser] = useState<UserResolved | null>(null);
  const [systemToken, setSystemToken] = useState<string | null>(null);
  const [anonymousToken, setAnonymousToken] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [claims, setClaims] = useState<AuthClaims>({
    roles: [],
    actorType: null,
    exchangeable: false,
    frontendDomains: [],
  });

  function applyAuthResponse(data: AuthResponse) {
    setSystemToken(data.systemToken);
    if (data.user) setUser(data.user);
    setClaims({
      roles: data.roles ?? [],
      actorType: data.actorType ?? null,
      exchangeable: data.exchangeable ?? false,
      frontendDomains: data.frontendDomains ?? [],
    });
    setAnonymousToken(null);
    setAuthLoading(false);
  }

  const refresh = useCallback(async (token?: string) => {
    const t = token ?? getCookie(TOKEN_COOKIE_NAME);
    if (!t) return;
    const res = await fetch("/api/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ systemToken: t }),
    });
    const json = await res.json();
    if (!json.success) {
      removeCookie(TOKEN_COOKIE_NAME);
      setUser(null);
      setSystemToken(null);
      setAnonymousToken(null);
      setAuthLoading(false);
      return;
    }
    setCookie(TOKEN_COOKIE_NAME, json.data.systemToken);
    setSystemToken(json.data.systemToken);
    if (json.data.user) setUser(json.data.user);
    setClaims({
      roles: (json.data.roles as string[]) ?? [],
      actorType: (json.data.actorType as "user" | "api_token") ?? null,
      exchangeable: (json.data.exchangeable as boolean) ?? false,
      frontendDomains: (json.data.frontendDomains as string[]) ?? [],
    });
    setAnonymousToken(null);
    setAuthLoading(false);
  }, []);

  useEffect(() => {
    const token = getCookie(TOKEN_COOKIE_NAME);
    if (token) {
      refresh(token).catch(() => {
        setUser(null);
        setSystemToken(null);
        setAnonymousToken(null);
        setAuthLoading(false);
      });
    } else {
      fetchAnonymousToken().then((t) => {
        setAnonymousToken(t);
        setAuthLoading(false);
      }).catch(() => {
        setAnonymousToken(null);
        setAuthLoading(false);
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
      setCookie(TOKEN_COOKIE_NAME, json.data.systemToken, stayLoggedIn ? 7 : 1);
      applyAuthResponse(json.data);
      return json.data;
    },
    [],
  );

  const logout = useCallback(() => {
    const currentToken = systemToken ?? getCookie(TOKEN_COOKIE_NAME);
    if (currentToken) {
      fetch("/api/auth/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${currentToken}` },
      }).catch(() => {});
    }
    removeCookie(TOKEN_COOKIE_NAME);
    setUser(null);
    setSystemToken(null);
    setClaims({
      roles: [],
      actorType: null,
      exchangeable: false,
      frontendDomains: [],
    });
    fetchAnonymousToken().then((t) => setAnonymousToken(t)).catch(() =>
      setAnonymousToken(null)
    );
  }, [systemToken]);

  const exchangeTenant = useCallback(
    async (companyId: string, systemId: string) => {
      const currentToken = systemToken ?? getCookie(TOKEN_COOKIE_NAME);
      if (!currentToken) throw new Error("No token available for exchange");
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
        throw new Error(json.error?.message ?? "auth.error.exchangeFailed");
      }
      setCookie(TOKEN_COOKIE_NAME, json.data.systemToken);
      setSystemToken(json.data.systemToken);
      setClaims({
        roles: (json.data.roles as string[]) ?? [],
        actorType: (json.data.actorType as "user" | "api_token") ?? null,
        exchangeable: (json.data.exchangeable as boolean) ?? false,
        frontendDomains: (json.data.frontendDomains as string[]) ?? [],
      });
      return json.data;
    },
    [systemToken],
  );

  const activeToken = systemToken ?? anonymousToken;
  const tenant = useMemo<Tenant>(() => {
    if (!activeToken) return { id: "" };
    return extractTenant(activeToken);
  }, [activeToken]);

  const [locale, setLocaleState] = useState<SupportedLocale>(() =>
    resolveInitialLocale(defaultLocale)
  );

  const setLocale = useCallback((newLocale: SupportedLocale) => {
    setLocaleState(newLocale);
    setCookie(LOCALE_COOKIE_NAME, newLocale);
    const token = systemToken ?? getCookie(TOKEN_COOKIE_NAME);
    if (token) {
      fetch("/api/users?action=locale", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ locale: newLocale }),
      }).catch(() => {});
    }
  }, [systemToken]);

  const [companies, setCompanies] = useState<Pick<Company, "id" | "name">[]>(
    [],
  );
  const [systems, setSystems] = useState<
    Pick<System, "id" | "name" | "slug" | "logoUri" | "defaultLocale">[]
  >([]);
  const [plan, setPlan] = useState<{ id: string; name: string } | null>(null);

  const companyId = tenant.companyId || null;
  const systemId: string | null = tenant.systemId || null;

  const switchCompany = useCallback((cId: string) => {
    setCookie(COMPANY_COOKIE, cId);
    setCookie(SYSTEM_COOKIE, "");
    setSystems([]);
    setPlan(null);
  }, []);

  const activeSys = useMemo(() => systems.find((s) => s.id === systemId), [
    systems,
    systemId,
  ]);
  const systemSlug = activeSys?.slug && activeSys.slug !== "core"
    ? activeSys.slug
    : null;

  const switchSystem = useCallback((sId: string) => {
    setCookie(SYSTEM_COOKIE, sId);
    const sys = systems.find((s) => s.id === sId);
    if (sys && companyId) exchangeTenant(companyId, sId).catch(console.error);
    setPlan(null);
  }, [systems, companyId, exchangeTenant]);

  const [fcSettings, setFcSettings] = useState<Map<string, string>>(new Map());
  const [frontCoreLoaded, setFrontCoreLoaded] = useState(false);
  const [timezoneOffsetMinutes, setTimezoneOffsetMinutes] = useState(0);

  const loadFrontCore = useCallback(async () => {
    try {
      const res = await fetch("/api/public/front-core");
      const json = await res.json();
      if (json.success && json.data) {
        const map = new Map<string, string>();
        for (
          const [key, setting] of Object.entries(
            json.data as Record<string, { value: string }>,
          )
        ) map.set(key, setting.value);
        setFcSettings(map);
      }
      if (typeof json.timezoneOffsetMinutes === "number") {
        setTimezoneOffsetMinutes(json.timezoneOffsetMinutes);
      }
    } catch { /* ignore */ }
    setFrontCoreLoaded(true);
  }, []);

  const [publicSystem, setPublicSystem] = useState<PublicSystemInfo | null>(
    null,
  );
  const [publicSystemLoading, setPublicSystemLoading] = useState(true);
  const [clientI18n, setClientI18n] = useState<ClientTranslations>(
    EMPTY_TRANSLATIONS,
  );

  const localeRef = useRef(locale);
  localeRef.current = locale;
  const setLocaleRef = useRef(setLocale);
  setLocaleRef.current = setLocale;

  const loadPublicSystem = useCallback(async (slug?: string) => {
    setPublicSystemLoading(true);
    try {
      const params = new URLSearchParams();
      if (slug) params.set("slug", slug);
      params.set("locale", localeRef.current);
      const res = await fetch(`/api/public/system?${params}`);
      const json = await res.json();
      if (json.success) {
        if (json.data) setPublicSystem(json.data);
        if (json.translations) setClientI18n(json.translations);
        if (
          json.data?.defaultLocale &&
          (supportedLocales as readonly string[]).includes(
            json.data.defaultLocale,
          ) && !document.cookie.includes("core_locale")
        ) {
          setLocaleRef.current(json.data.defaultLocale as SupportedLocale);
        }
      }
    } catch { /* ignore */ }
    setPublicSystemLoading(false);
  }, []);

  useEffect(() => {
    loadFrontCore();
    const urlSlug = new URLSearchParams(window.location.search).get(
      "systemSlug",
    );
    loadPublicSystem(urlSlug ?? undefined);
  }, [loadFrontCore, loadPublicSystem]);

  // Re-fetch translations silently when locale changes
  const prevLocaleRef = useRef(locale);
  useEffect(() => {
    if (prevLocaleRef.current === locale) return;
    prevLocaleRef.current = locale;
    const slug = publicSystem?.slug ?? systemSlug;
    if (!slug) return;
    const params = new URLSearchParams();
    params.set("locale", locale);
    params.set("slug", slug);
    fetch(`/api/public/system?${params}`)
      .then((res) => res.json())
      .then((json) => {
        if (json.success && json.translations) {
          setClientI18n(json.translations);
        }
      })
      .catch(() => {});
  }, [locale, publicSystem?.slug, systemSlug]);

  const getSetting = useCallback((key: string) => fcSettings.get(key), [
    fcSettings,
  ]);
  const reloadFrontCore = useCallback(async () => {
    await loadFrontCore();
  }, [loadFrontCore]);

  const t = useCallback(
    (key: string, params?: Record<string, string>) =>
      translate(key, locale, params, clientI18n),
    [locale, clientI18n],
  );

  const value = useMemo<TenantContextValue>(() => ({
    user,
    systemToken,
    anonymousToken,
    loading: authLoading,
    tenant,
    ...claims,
    timezoneOffsetMinutes,
    login,
    logout,
    refresh,
    exchangeTenant,
    locale,
    setLocale,
    t,
    supportedLocales,
    companies,
    systems,
    plan,
    companyId,
    systemId,
    systemSlug,
    setCompanies,
    setSystems,
    setPlan,
    switchCompany,
    switchSystem,
    getSetting,
    frontCoreLoaded,
    reloadFrontCore,
    publicSystem,
    publicSystemLoading,
    loadPublicSystem,
  }), [
    user,
    systemToken,
    anonymousToken,
    authLoading,
    tenant,
    claims,
    timezoneOffsetMinutes,
    login,
    logout,
    refresh,
    exchangeTenant,
    locale,
    setLocale,
    t,
    companies,
    systems,
    plan,
    companyId,
    systemId,
    systemSlug,
    setCompanies,
    setSystems,
    setPlan,
    switchCompany,
    switchSystem,
    getSetting,
    frontCoreLoaded,
    reloadFrontCore,
    publicSystem,
    publicSystemLoading,
    loadPublicSystem,
  ]);

  useEffect(() => {
    if (publicSystemLoading) return;
    if (publicSystem?.name) {
      document.title = publicSystem.name;
    }
    const existing = document.querySelector("link[rel='icon']");
    if (publicSystem?.logoUri) {
      const href = `/api/files/download?uri=${
        encodeURIComponent(publicSystem.logoUri)
      }`;
      if (existing) {
        existing.setAttribute("href", href);
      } else {
        const link = document.createElement("link");
        link.rel = "icon";
        link.href = href;
        document.head.appendChild(link);
      }
    }
  }, [publicSystem, publicSystemLoading]);

  return (
    <TenantContext.Provider value={value}>{children}</TenantContext.Provider>
  );
}

export function useTenantContext(): TenantContextValue {
  const ctx = useContext(TenantContext);
  if (!ctx) {
    throw new Error("useTenantContext must be used within a <TenantProvider>");
  }
  return ctx;
}

export function useBearerToken(): string | null {
  const { systemToken, anonymousToken } = useTenantContext();
  return systemToken ?? anonymousToken;
}
