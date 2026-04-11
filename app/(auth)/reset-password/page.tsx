"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale } from "@/src/hooks/useLocale";
import { usePublicSystem } from "@/src/hooks/usePublicSystem";
import Spinner from "@/src/components/shared/Spinner";
import ErrorDisplay from "@/src/components/shared/ErrorDisplay";
import LocaleSelector from "@/src/components/shared/LocaleSelector";
import SystemBranding from "@/src/components/shared/SystemBranding";

function ResetPasswordContent() {
  const { t } = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const systemSlug = searchParams.get("system");
  const { systemInfo, loading: brandingLoading } = usePublicSystem(systemSlug);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const systemParam = systemSlug
    ? `?system=${encodeURIComponent(systemSlug)}`
    : "";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError("auth.register.error.passwordMismatch");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password, confirmPassword }),
      });
      const json = await res.json();

      if (json.success) {
        router.push(`/login${systemParam}`);
      } else {
        setError(
          json.error?.code === "EXPIRED"
            ? "auth.resetPassword.error.invalid"
            : (json.error?.message ?? "common.error.generic"),
        );
      }
    } catch {
      setError("common.error.network");
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[var(--color-black)] via-[#0a0a0a] to-[#111] px-4">
        <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-2xl p-8 text-center">
          <ErrorDisplay message="auth.resetPassword.error.invalid" />
        </div>
      </div>
    );
  }

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
              {t("auth.resetPassword.title")}
            </h1>
            <p className="mt-2 text-[var(--color-light-text)]">
              {t("auth.resetPassword.subtitle")}
            </p>
          </div>

          <ErrorDisplay message={error} />

          <form onSubmit={handleSubmit} className="mt-6 space-y-5">
            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-[var(--color-light-text)] mb-1"
              >
                {t("auth.resetPassword.password")}
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                className="w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-3 text-white placeholder-[var(--color-light-text)]/50 outline-none focus:border-[var(--color-primary-green)] transition-colors"
              />
            </div>

            <div>
              <label
                htmlFor="confirmPassword"
                className="block text-sm font-medium text-[var(--color-light-text)] mb-1"
              >
                {t("auth.resetPassword.confirmPassword")}
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-3 text-white placeholder-[var(--color-light-text)]/50 outline-none focus:border-[var(--color-primary-green)] transition-colors"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] px-4 py-3 font-semibold text-black transition-all hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading
                ? (
                  <Spinner
                    size="sm"
                    className="border-black border-t-transparent"
                  />
                )
                : null}
              {t("auth.resetPassword.submit")}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[var(--color-black)]">
          <Spinner size="lg" />
        </div>
      }
    >
      <ResetPasswordContent />
    </Suspense>
  );
}
