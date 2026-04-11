"use client";

import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import {
  defaultLocale as fallbackLocale,
  type SupportedLocale,
  supportedLocales,
  t as translate,
} from "@/src/i18n";
const LOCALE_COOKIE_NAME = "core_locale";
const TOKEN_COOKIE_NAME = "core_token";

function getCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match?.[1];
}

function setCookie(name: string, value: string, days: number = 365): void {
  if (typeof document === "undefined") return;
  const expires = new Date(Date.now() + days * 86400000).toUTCString();
  document.cookie =
    `${name}=${value}; expires=${expires}; path=/; SameSite=Lax`;
}

export interface LocaleContextValue {
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;
  t: (key: string, params?: Record<string, string>) => string;
  supportedLocales: readonly string[];
}

export const LocaleContext = createContext<LocaleContextValue | null>(null);

interface LocaleProviderProps {
  children: ReactNode;
  defaultLocale?: string;
}

export function LocaleProvider(
  { children, defaultLocale }: LocaleProviderProps,
) {
  const resolvedDefault: SupportedLocale = (
      defaultLocale &&
      (supportedLocales as readonly string[]).includes(defaultLocale)
    )
    ? (defaultLocale as SupportedLocale)
    : fallbackLocale;

  const [locale, setLocaleState] = useState<SupportedLocale>(resolvedDefault);

  useEffect(() => {
    const stored = getCookie(LOCALE_COOKIE_NAME) as SupportedLocale | undefined;
    if (stored && (supportedLocales as readonly string[]).includes(stored)) {
      setLocaleState(stored);
    }
  }, []);

  const setLocale = useCallback((newLocale: SupportedLocale) => {
    setLocaleState(newLocale);
    setCookie(LOCALE_COOKIE_NAME, newLocale);

    // Sync locale to user profile if authenticated
    const token = getCookie(TOKEN_COOKIE_NAME);
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
  }, []);

  const t = useCallback(
    (key: string, params?: Record<string, string>) =>
      translate(key, locale, params),
    [locale],
  );

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, setLocale, t, supportedLocales }),
    [locale, setLocale, t],
  );

  return (
    <LocaleContext.Provider value={value}>
      {children}
    </LocaleContext.Provider>
  );
}
