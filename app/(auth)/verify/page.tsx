"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Spinner from "@/src/components/shared/Spinner";
import ErrorDisplay from "@/src/components/shared/ErrorDisplay";
import GenericFormButton from "@/src/components/shared/GenericFormButton";
import LocaleSelector from "@/src/components/shared/LocaleSelector";
import SystemBranding from "@/src/components/shared/SystemBranding";
import Link from "next/link";
import { useTenantContext } from "@/src/hooks/useTenantContext";

function VerifyContent() {
  const {
    t,
    refresh,
    publicSystem: systemInfo,
    publicSystemLoading: brandingLoading,
    loadPublicSystem,
  } = useTenantContext();
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const systemSlug = searchParams.get("systemSlug");
  const identifierParam = searchParams.get("identifier") ?? "";
  useEffect(() => {
    loadPublicSystem(systemSlug ?? undefined);
  }, [systemSlug, loadPublicSystem]);

  const [identifier, setIdentifier] = useState(identifierParam);
  const [verifying, setVerifying] = useState(!!token);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [successAction, setSuccessAction] = useState<string | null>(null);
  const [resent, setResent] = useState(false);

  const systemParam = systemSlug
    ? `?systemSlug=${encodeURIComponent(systemSlug)}`
    : "";
  const loginHref = `/login${systemParam}`;

  useEffect(() => {
    setIdentifier(identifierParam);
  }, [identifierParam]);

  useEffect(() => {
    if (!token) {
      setVerifying(false);
      return;
    }

    (async () => {
      try {
        const res = await fetch("/api/approvals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const json = await res.json();

        if (json.success) {
          setSuccess(true);
          setSuccessAction(json.data?.actionKey ?? null);
          if (
            json.data?.actionKey === "auth.action.loginFallback" &&
            typeof json.data?.systemToken === "string"
          ) {
            await refresh(json.data.systemToken);
            router.push(
              json.data.user?.roles?.includes("superuser")
                ? "/systems"
                : "/entry",
            );
          }
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
        setVerifying(false);
      }
    })();
  }, [token, refresh, router]);

  const handleResend = async (e: React.FormEvent) => {
    e.preventDefault();
    setResending(true);
    setError(null);
    setResent(false);

    try {
      const res = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier,
          systemSlug: systemSlug || undefined,
        }),
      });
      const json = await res.json();

      if (json.success) {
        setResent(true);
      } else {
        setError(json.error?.message ?? "common.error.generic");
      }
    } catch {
      setError("common.error.network");
    } finally {
      setResending(false);
    }
  };

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

          {verifying && (
            <div className="flex justify-center py-8">
              <Spinner size="lg" />
            </div>
          )}

          {!verifying && success && (
            <div className="space-y-4">
              <p className="text-[var(--color-primary-green)] text-lg">
                {successAction === "access.request"
                  ? t("access.approved")
                  : t("auth.verify.success")}
              </p>
              <Link
                href={loginHref}
                className="inline-block rounded-lg bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] px-6 py-3 font-semibold text-black transition-all hover:opacity-90"
              >
                {t("auth.login.submit")}
              </Link>
            </div>
          )}

          {!verifying && !success && (
            <div className="space-y-4">
              <ErrorDisplay message={error} />
              <p className="text-[var(--color-light-text)]">
                {resent ? t("auth.verify.resent") : t("auth.verify.subtitle")}
              </p>

              <form onSubmit={handleResend} className="space-y-4 text-left">
                <div>
                  <label
                    htmlFor="identifier"
                    className="mb-1 block text-sm font-medium text-[var(--color-light-text)]"
                  >
                    {t("auth.login.identifier")}
                  </label>
                  <input
                    id="identifier"
                    type="text"
                    autoComplete="username"
                    value={identifier}
                    onChange={(e) => {
                      setIdentifier(e.target.value);
                      setResent(false);
                    }}
                    required
                    placeholder={t("common.placeholder.entityChannel")}
                    className="w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-3 text-white placeholder-white/30 outline-none transition-colors focus:border-[var(--color-primary-green)]"
                  />
                </div>

                <GenericFormButton
                  loading={resending}
                  label={t("auth.verify.resend")}
                  disabled={!identifier.trim()}
                />
              </form>

              <Link
                href={loginHref}
                className="inline-block text-[var(--color-secondary-blue)] transition-colors hover:text-[var(--color-primary-green)]"
              >
                {t("auth.forgotPassword.backToLogin")}
              </Link>
            </div>
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
