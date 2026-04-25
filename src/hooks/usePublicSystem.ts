"use client";

import { useEffect, useState } from "react";
import type { PublicSystemInfo } from "@/src/contracts/system";
import { useLocale } from "./useLocale";
import { useBrandingHeader } from "./useBrandingHeader";
import { type SupportedLocale, supportedLocales } from "@/src/i18n";

export function usePublicSystem(slug: string | null) {
  const [systemInfo, setSystemInfo] = useState<PublicSystemInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const { locale, setLocale } = useLocale();

  useEffect(() => {
    let cancelled = false;

    async function fetchSystem() {
      try {
        const url = slug
          ? `/api/public/system?slug=${encodeURIComponent(slug)}`
          : "/api/public/system?default=true";
        const res = await fetch(url);
        const json = await res.json();
        if (!cancelled && json.success && json.data) {
          setSystemInfo(json.data);

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
        if (!cancelled) setLoading(false);
      }
    }

    fetchSystem();
    return () => {
      cancelled = true;
    };
  }, [slug, setLocale]);

  const logoUrl = systemInfo?.logoUri
    ? `/api/files/download?uri=${encodeURIComponent(systemInfo.logoUri)}`
    : null;
  useBrandingHeader(systemInfo?.name, logoUrl);

  return { systemInfo, loading };
}
