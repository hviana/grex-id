"use client";

import { useEffect, useMemo, useState } from "react";
import { useTenantContext } from "@/src/hooks/useTenantContext";
import { getCookie } from "@/src/lib/cookies";

const CONSENT_COOKIE = "core_data_tracking_consent";

export interface DataTrackingConsentState {
  /** True only when the cookie equals "accepted". */
  accepted: boolean;
  /** True once the user has clicked either button (cookie present). */
  decided: boolean;
  /** Resolved list from `front.dataTracking.trackedCharacteristics`. */
  trackedCharacteristics: string[];
}

/**
 * Gates access to the characteristics listed in
 * `front.dataTracking.trackedCharacteristics` (§9.8, §9.8). Call-site:
 * any code that captures a characteristic from that list MUST bail when
 * `accepted` is false.
 */
export function useDataTrackingConsent(): DataTrackingConsentState {
  const { getSetting } = useTenantContext();
  // On the very first render (SSR or client hydration) `document` is either
  // absent or the cookie hasn't been read yet — treat that as "undecided"
  // and read the cookie on mount. Subsequent cross-tab changes are picked up
  // via the `storage` event.
  const [cookieValue, setCookieValue] = useState<string | undefined>(() => {
    if (typeof document === "undefined") return undefined;
    return getCookie(CONSENT_COOKIE);
  });

  useEffect(() => {
    const onStorage = () => setCookieValue(getCookie(CONSENT_COOKIE));
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const trackedCharacteristics = useMemo<string[]>(() => {
    const raw = getSetting(
      "front.dataTracking.trackedCharacteristics",
    );
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.filter((v): v is string => typeof v === "string")
        : [];
    } catch {
      return [];
    }
  }, [getSetting]);

  return {
    accepted: cookieValue === "accepted",
    decided: cookieValue === "accepted" || cookieValue === "declined",
    trackedCharacteristics,
  };
}
