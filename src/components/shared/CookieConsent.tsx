"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale } from "@/src/hooks/useLocale";
import { getCookie, setCookie } from "@/src/lib/cookies";

const CONSENT_COOKIE = "core_data_tracking_consent";
const SIX_MONTHS_DAYS = 180;

/**
 * Global data-tracking consent popup (§9.8, §9.8). Mounted once at the
 * root layout so it covers every page — public and authenticated. Decision
 * persists for 6 months in the `core_data_tracking_consent` cookie.
 */
export default function CookieConsent() {
  const { t } = useLocale();
  const searchParams = useSearchParams();

  // Server and first client render must match → start hidden. After mount,
  // read the cookie and reveal the popup only when no decision was recorded.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (getCookie(CONSENT_COOKIE) === undefined) setVisible(true);
  }, []);

  // Resolve the terms link target. Prefer the ?systemSlug= query param (present
  // on auth pages + public homepage). When absent, hit `/terms` without a
  // slug — the page will show the core generic terms (§25.1 resolution
  // order). `app.defaultSystem` is a server-only setting and is not
  // consumable here; if the superuser wants the popup to point at a specific
  // system by default, they should set `?systemSlug=` on the relevant links.
  const systemFromUrl = searchParams.get("systemSlug");
  const termsHref = systemFromUrl
    ? `/terms?systemSlug=${encodeURIComponent(systemFromUrl)}`
    : "/terms";

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
