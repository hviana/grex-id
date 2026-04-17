"use client";

import { createContext, useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  defaultLocale as fallbackLocale,
  type SupportedLocale,
  supportedLocales,
  t as translate,
} from "@/src/i18n";
import { getCookie, setCookie } from "@/src/lib/cookies";
const LOCALE_COOKIE_NAME = "core_locale";
const TOKEN_COOKIE_NAME = "core_token";

function resolveBrowserLocale(): SupportedLocale | undefined {
  if (typeof navigator === "undefined" || !navigator.languages) {
    return undefined;
  }
  const locales = supportedLocales as readonly string[];
  // Pass 1: exact match
  for (const tag of navigator.languages) {
    if (locales.includes(tag)) return tag as SupportedLocale;
  }
  // Pass 2: primary subtag prefix match
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

/**
 * Resolve initial locale per §5.3 order:
 * (1) core_locale cookie → (2) browser navigator.languages →
 * (3) System.defaultLocale prop → (4) hardcoded "en"
 */
function resolveInitialLocale(
  defaultLocale?: string,
): SupportedLocale {
  const valid = supportedLocales as readonly string[];

  // Step 1: cookie
  const stored = getCookie(LOCALE_COOKIE_NAME);
  if (stored && valid.includes(stored)) return stored as SupportedLocale;

  // Step 2: browser languages (two-pass per §5.3)
  const browser = resolveBrowserLocale();
  if (browser) return browser;

  // Step 3: system defaultLocale prop
  if (defaultLocale && valid.includes(defaultLocale)) {
    return defaultLocale as SupportedLocale;
  }

  // Step 4: hardcoded fallback
  return fallbackLocale;
}

export function LocaleProvider(
  { children, defaultLocale }: LocaleProviderProps,
) {
  const [locale, setLocaleState] = useState<SupportedLocale>(
    () => resolveInitialLocale(defaultLocale),
  );

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
