"use client";

import { useEffect, useMemo, useState } from "react";
import { useFrontCore } from "./useFrontCore";
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
 * `front.dataTracking.trackedCharacteristics` (§10.2.6, §25.6). Call-site:
 * any code that captures a characteristic from that list MUST bail when
 * `accepted` is false.
 */
export function useDataTrackingConsent(): DataTrackingConsentState {
  const frontCore = useFrontCore();
  const [cookieValue, setCookieValue] = useState<string | undefined>(
    undefined,
  );

  useEffect(() => {
    setCookieValue(getCookie(CONSENT_COOKIE));
    // Cookies are not observable — re-read on storage events as a best-effort
    // broadcast channel; consumers that need instant re-evaluation can also
    // call `location.reload()` after the user decides.
    const onStorage = () => setCookieValue(getCookie(CONSENT_COOKIE));
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const trackedCharacteristics = useMemo<string[]>(() => {
    const raw = frontCore.getSetting(
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
  }, [frontCore]);

  return {
    accepted: cookieValue === "accepted",
    decided: cookieValue === "accepted" || cookieValue === "declined",
    trackedCharacteristics,
  };
}
