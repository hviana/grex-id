"use client";

import { useEffect, useState } from "react";
import type { PublicSystemInfo } from "@/src/contracts/system";
import { useLocale } from "./useLocale";
import { type SupportedLocale, supportedLocales } from "@/src/i18n";

export function usePublicSystem(slug: string | null) {
  const [systemInfo, setSystemInfo] = useState<PublicSystemInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const { locale, setLocale } = useLocale();

  useEffect(() => {
    async function fetch_system() {
      try {
        const url = slug
          ? `/api/public/system?slug=${encodeURIComponent(slug)}`
          : "/api/public/system?default=true";
        const res = await fetch(url);
        const json = await res.json();
        if (json.success && json.data) {
          setSystemInfo(json.data);

          // If user hasn't explicitly chosen a locale (no cookie),
          // apply the system's default locale
          if (
            json.data.defaultLocale &&
            (supportedLocales as readonly string[]).includes(
              json.data.defaultLocale,
            ) &&
            !document.cookie.includes("core_locale")
          ) {
            setLocale(json.data.defaultLocale as SupportedLocale);
          }
        }
      } catch {
        // ignore — fallback to no branding
      } finally {
        setLoading(false);
      }
    }

    fetch_system();
  }, [slug, setLocale]);

  return { systemInfo, loading };
}
