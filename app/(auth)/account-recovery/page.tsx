"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Spinner from "@/src/components/shared/Spinner";
import GenericFormButton from "@/src/components/shared/GenericFormButton";
import ErrorDisplay from "@/src/components/shared/ErrorDisplay";
import BotProtection from "@/src/components/shared/BotProtection";
import LocaleSelector from "@/src/components/shared/LocaleSelector";
import SystemBranding from "@/src/components/shared/SystemBranding";
import Link from "next/link";
import { useTenantContext } from "@/src/hooks/useTenantContext";

function AccountRecoveryContent() {
  const searchParams = useSearchParams();
  const systemSlug = searchParams.get("systemSlug");
  const {
    t,
    publicSystem: systemInfo,
    publicSystemLoading: brandingLoading,
    loadPublicSystem,
  } = useTenantContext();
  useEffect(() => {
    loadPublicSystem(systemSlug ?? undefined);
  }, [systemSlug, loadPublicSystem]);

  const [channelValue, setChannelValue] = useState("");
  const [botToken, setBotToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const systemParam = systemSlug
    ? `?systemSlug=${encodeURIComponent(systemSlug)}`
    : "";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!botToken) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier: channelValue,
          botToken,
          systemSlug: systemSlug || undefined,
        }),
      });
      const json = await res.json();

      if (json.success) {
        setSent(true);
      } else {
        setError(json.error?.message ?? "common.error.generic");
      }
    } catch {
      setError("common.error.network");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[var(--color-black)] via-[#0a0a0a] to-[#111] px-4">
      <div className="absolute top-4 right-4">
        <LocaleSelector />
      </div>

      <div className="w-full max-w-md">
        <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-2xl p-8">
          <SystemBranding systemInfo={systemInfo} loading={brandingLoading} />

          <div className="mb-8 text-center">
            <h1 className="text-3xl font-bold bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent">
              {t("auth.accountRecovery.title")}
            </h1>
            <p className="mt-2 text-[var(--color-light-text)]">
              {t("auth.accountRecovery.subtitle")}
            </p>
          </div>

          {sent
            ? (
              <div className="text-center space-y-4">
                <p className="text-[var(--color-primary-green)]">
                  {t("auth.accountRecovery.success")}
                </p>
                <Link
                  href={`/login${systemParam}`}
                  className="inline-block text-[var(--color-secondary-blue)] hover:text-[var(--color-primary-green)] transition-colors"
                >
                  {t("auth.accountRecovery.backToLogin")}
                </Link>
              </div>
            )
            : (
              <>
                <ErrorDisplay message={error} />
                <form onSubmit={handleSubmit} className="mt-6 space-y-5">
                  <div>
                    <label
                      htmlFor="channelValue"
                      className="block text-sm font-medium text-[var(--color-light-text)] mb-1"
                    >
                      {t("auth.accountRecovery.channelValue")}
                    </label>
                    <input
                      id="channelValue"
                      type="text"
                      value={channelValue}
                      onChange={(e) => setChannelValue(e.target.value)}
                      required
                      placeholder={t("common.placeholder.entityChannel")}
                      className="w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-3 text-white placeholder-white/30 outline-none focus:border-[var(--color-primary-green)] transition-colors"
                    />
                  </div>

                  <BotProtection onVerified={setBotToken} />

                  <GenericFormButton
                    loading={loading}
                    label={t("auth.accountRecovery.submit")}
                    disabled={!botToken}
                  />
                </form>

                <div className="mt-6 text-center space-y-2">
                  <p className="text-sm">
                    <Link
                      href={`/forgot-password${systemParam}`}
                      className="text-[var(--color-secondary-blue)] hover:text-[var(--color-primary-green)] transition-colors"
                    >
                      {t("auth.forgotPassword.title")}
                    </Link>
                  </p>
                  <p className="text-sm">
                    <Link
                      href={`/login${systemParam}`}
                      className="text-[var(--color-secondary-blue)] hover:text-[var(--color-primary-green)] transition-colors"
                    >
                      {t("auth.accountRecovery.backToLogin")}
                    </Link>
                  </p>
                </div>
              </>
            )}
        </div>
      </div>
    </div>
  );
}

export default function AccountRecoveryPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[var(--color-black)]">
          <Spinner size="lg" />
        </div>
      }
    >
      <AccountRecoveryContent />
    </Suspense>
  );
}
