"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale } from "@/src/hooks/useLocale";
import { usePublicSystem } from "@/src/hooks/usePublicSystem";
import Spinner from "@/src/components/shared/Spinner";
import ErrorDisplay from "@/src/components/shared/ErrorDisplay";
import LocaleSelector from "@/src/components/shared/LocaleSelector";
import SystemBranding from "@/src/components/shared/SystemBranding";
import Link from "next/link";

function VerifyContent() {
  const { t } = useLocale();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const systemSlug = searchParams.get("system");
  const { systemInfo, loading: brandingLoading } = usePublicSystem(systemSlug);

  const [loading, setLoading] = useState(!!token);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const systemParam = systemSlug
    ? `?system=${encodeURIComponent(systemSlug)}`
    : "";

  useEffect(() => {
    if (!token) return;

    (async () => {
      try {
        const res = await fetch("/api/auth/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const json = await res.json();

        if (json.success) {
          setSuccess(true);
        } else {
          setError(
            json.error?.code === "EXPIRED"
              ? "auth.verify.error.expired"
              : (json.error?.message ?? "auth.verify.error.invalid"),
          );
        }
      } catch {
        setError("common.error.network");
      } finally {
        setLoading(false);
      }
    })();
  }, [token, t]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[var(--color-black)] via-[#0a0a0a] to-[#111] px-4">
      <div className="absolute top-4 right-4">
        <LocaleSelector />
      </div>

      <div className="w-full max-w-md">
        <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-2xl p-8 text-center">
          <SystemBranding systemInfo={systemInfo} loading={brandingLoading} />

          <h1 className="text-3xl font-bold bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent mb-4">
            {t("auth.verify.title")}
          </h1>

          {loading && (
            <div className="flex justify-center py-8">
              <Spinner size="lg" />
            </div>
          )}

          {!loading && success && (
            <div className="space-y-4">
              <p className="text-[var(--color-primary-green)] text-lg">
                {t("auth.verify.success")}
              </p>
              <Link
                href={`/login${systemParam}`}
                className="inline-block rounded-lg bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] px-6 py-3 font-semibold text-black transition-all hover:opacity-90"
              >
                {t("auth.login.submit")}
              </Link>
            </div>
          )}

          {!loading && error && (
            <div className="space-y-4">
              <ErrorDisplay message={error} />
            </div>
          )}

          {!loading && !token && !success && (
            <p className="text-[var(--color-light-text)]">
              {t("auth.verify.subtitle")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[var(--color-black)]">
          <Spinner size="lg" />
        </div>
      }
    >
      <VerifyContent />
    </Suspense>
  );
}
