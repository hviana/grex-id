"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale } from "@/src/hooks/useLocale";
import { useFrontCore } from "@/src/hooks/useFrontCore";
import { getCookie, setCookie } from "@/src/lib/cookies";

const CONSENT_COOKIE = "core_data_tracking_consent";
const SIX_MONTHS_DAYS = 180;

/**
 * Global data-tracking consent popup (§18.1.3, §25.6). Mounted once at the
 * root layout so it covers every page — public and authenticated. Decision
 * persists for 6 months in the `core_data_tracking_consent` cookie.
 */
export default function CookieConsent() {
  const { t } = useLocale();
  const frontCore = useFrontCore();
  const searchParams = useSearchParams();

  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Defer until after hydration so the server-rendered shell matches.
    const existing = getCookie(CONSENT_COOKIE);
    if (!existing) setVisible(true);
  }, []);

  // Resolve the terms link target. Prefer the ?system= query param (present
  // on auth pages + public homepage), fall back to FrontCore's
  // `front.app.defaultSystem` when eventually exposed; otherwise leave the
  // slug empty and let `/terms` show the core fallback.
  const systemFromUrl = searchParams.get("system");
  const termsHref = systemFromUrl
    ? `/terms?system=${encodeURIComponent(systemFromUrl)}`
    : "/terms";

  // Ensure FrontCore is loaded (silent no-op when it already is). We don't
  // block the popup on the response — the list of tracked characteristics is
  // only consulted by consumers of the consent state, not by the popup itself.
  useEffect(() => {
    if (!frontCore.loaded) {
      frontCore.reload().catch(() => {});
    }
  }, [frontCore]);

  const decide = (accepted: boolean) => {
    setCookie(
      CONSENT_COOKIE,
      accepted ? "accepted" : "declined",
      SIX_MONTHS_DAYS,
    );
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-[100] p-3 pointer-events-none">
      <div className="pointer-events-auto mx-auto max-w-3xl rounded-2xl border border-dashed border-[var(--color-dark-gray)] bg-[#0a0a0a]/95 backdrop-blur-md shadow-lg shadow-black/40 p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <p className="flex-1 text-sm text-[var(--color-light-text)]">
          {t("common.cookieConsent.message")}{" "}
          <a
            href={termsHref}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--color-secondary-blue)] hover:text-[var(--color-primary-green)] underline transition-colors"
          >
            {t("common.cookieConsent.readTerms")}
          </a>
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => decide(false)}
            className="rounded-lg border border-[var(--color-dark-gray)] px-4 py-2 text-sm text-[var(--color-light-text)] hover:bg-white/5 transition-colors"
          >
            {t("common.cookieConsent.decline")}
          </button>
          <button
            type="button"
            onClick={() => decide(true)}
            className="rounded-lg bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] px-4 py-2 text-sm font-semibold text-black transition-all hover:opacity-90"
          >
            {t("common.cookieConsent.accept")}
          </button>
        </div>
      </div>
    </div>
  );
}
