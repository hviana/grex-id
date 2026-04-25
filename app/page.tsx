"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale } from "@/src/hooks/useLocale";
import Spinner from "@/src/components/shared/Spinner";
import LocaleSelector from "@/src/components/shared/LocaleSelector";
import { getHomePage } from "@/src/components/systems/registry";
import { useBrandingHeader } from "@/src/hooks/useBrandingHeader";

function HomeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useLocale();
  const systemSlug = searchParams.get("systemSlug");

  const [resolvedSlug, setResolvedSlug] = useState<string | null>(systemSlug);
  const [systemName, setSystemName] = useState<string | null>(null);
  const [systemLogoUri, setSystemLogoUri] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  // Only fetch when we need to resolve a system (explicit param or default)
  useEffect(() => {
    async function resolve() {
      try {
        const url = systemSlug
          ? `/api/public/system?slug=${encodeURIComponent(systemSlug)}`
          : "/api/public/system?default=true";
        const res = await fetch(url);
        const json = await res.json();
        if (json.success && json.data) {
          setResolvedSlug(json.data.slug);
          setSystemName(json.data.name ?? null);
          setSystemLogoUri(json.data.logoUri ?? null);
        }
      } catch {
        // Fall through to core homepage
      } finally {
        setLoading(false);
      }
    }

    resolve();
  }, [systemSlug]);

  const logoUrl = systemLogoUri
    ? `/api/files/download?uri=${encodeURIComponent(systemLogoUri)}`
    : null;
  useBrandingHeader(systemName, logoUrl);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--color-black)]">
        <Spinner size="lg" />
      </div>
    );
  }

  // Delegate to system-specific homepage if one is registered
  if (resolvedSlug) {
    const SystemHomePage = getHomePage(resolvedSlug);
    if (SystemHomePage) {
      return (
        <Suspense
          fallback={
            <div className="flex min-h-screen items-center justify-center bg-[var(--color-black)]">
              <Spinner size="lg" />
            </div>
          }
        >
          <SystemHomePage />
        </Suspense>
      );
    }
  }

  // Core homepage
  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-[var(--color-black)] via-[#0a0a0a] to-[#111]">
      <div className="absolute top-4 right-4">
        <LocaleSelector />
      </div>

      <main className="flex flex-1 flex-col items-center justify-center px-4 text-center">
        <h1 className="text-5xl font-bold bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent sm:text-6xl">
          {t("homepage.core.title")}
        </h1>

        <p className="mt-6 max-w-2xl text-lg text-[var(--color-light-text)] leading-relaxed">
          {t("homepage.core.subtitle")}
        </p>

        <div className="mt-10">
          <button
            onClick={() => router.push("/login")}
            className="rounded-lg bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] px-8 py-4 text-lg font-semibold text-black transition-all hover:opacity-90 hover:-translate-y-1 hover:shadow-lg hover:shadow-[var(--color-light-green)]/20"
          >
            {t("homepage.cta")}
          </button>
        </div>
      </main>

      <footer className="py-6 text-center text-sm text-[var(--color-light-text)]">
        {t("homepage.footer")}
      </footer>
    </div>
  );
}

export default function HomePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[var(--color-black)]">
          <Spinner size="lg" />
        </div>
      }
    >
      <HomeContent />
    </Suspense>
  );
}
