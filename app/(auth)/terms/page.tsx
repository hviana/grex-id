"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Spinner from "@/src/components/shared/Spinner";
import LocaleSelector from "@/src/components/shared/LocaleSelector";
import SystemBranding from "@/src/components/shared/SystemBranding";
import { useTenantContext } from "@/src/hooks/useTenantContext";

function TermsContent() {
  const searchParams = useSearchParams();
  const systemSlug = searchParams.get("systemSlug");
  const { t, publicSystem: systemInfo, publicSystemLoading: loading, loadPublicSystem } = useTenantContext();
  useEffect(() => { loadPublicSystem(systemSlug ?? undefined); }, [systemSlug, loadPublicSystem]);

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-[var(--color-black)] via-[#0a0a0a] to-[#111]">
      <div className="absolute top-4 right-4">
        <LocaleSelector />
      </div>

      <div className="flex-1 flex flex-col items-center px-4 py-8">
        <div className="w-full max-w-3xl">
          <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-2xl p-8 hover:shadow-lg hover:shadow-[var(--color-light-green)]/10 transition-all duration-300">
            <SystemBranding systemInfo={systemInfo} loading={loading} />

            <h1 className="text-2xl font-bold bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent text-center mb-6">
              {t("common.terms.title")}
            </h1>

            {loading
              ? (
                <div className="flex justify-center py-12">
                  <Spinner size="lg" />
                </div>
              )
              : systemInfo?.termsOfService
              ? (
                <div
                  className="text-[var(--color-light-text)] text-sm leading-relaxed whitespace-pre-wrap text-left"
                  dangerouslySetInnerHTML={{
                    __html: systemInfo.termsOfService,
                  }}
                />
              )
              : (
                <div className="text-center py-8">
                  <p className="text-[var(--color-light-text)]">
                    {t("common.terms.fallback")}
                  </p>
                </div>
              )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TermsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[var(--color-black)]">
          <Spinner size="lg" />
        </div>
      }
    >
      <TermsContent />
    </Suspense>
  );
}
