"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/src/hooks/useAuth";
import { useLocale } from "@/src/hooks/useLocale";
import { usePublicSystem } from "@/src/hooks/usePublicSystem";
import Spinner from "@/src/components/shared/Spinner";
import ErrorDisplay from "@/src/components/shared/ErrorDisplay";
import BotProtection from "@/src/components/shared/BotProtection";
import LocaleSelector from "@/src/components/shared/LocaleSelector";
import SystemBranding from "@/src/components/shared/SystemBranding";
import Link from "next/link";

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const systemSlug = searchParams.get("system");
  const isOAuth = searchParams.get("oauth") === "1";
  const oauthClientName = searchParams.get("client_name") ?? "";
  const oauthPermissions = searchParams.get("permissions") ?? "";
  const oauthSystemSlug = searchParams.get("system_slug") ?? systemSlug ?? "";
  const oauthRedirectOrigin = searchParams.get("redirect_origin") ?? "";
  const { login } = useAuth();
  const { t } = useLocale();
  const { systemInfo, loading: brandingLoading } = usePublicSystem(systemSlug);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [stayLoggedIn, setStayLoggedIn] = useState(false);
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [show2FA, setShow2FA] = useState(false);
  const [botToken, setBotToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const systemParam = systemSlug
    ? `?system=${encodeURIComponent(systemSlug)}`
    : "";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!botToken) return;
    setLoading(true);
    setError(null);

    try {
      const result = await login(
        email,
        password,
        stayLoggedIn,
        twoFactorCode || undefined,
      );
      if (isOAuth && oauthClientName) {
        // Redirect to OAuth authorization page preserving all params
        const params = new URLSearchParams({
          client_name: oauthClientName,
          permissions: oauthPermissions,
          system_slug: oauthSystemSlug,
          redirect_origin: oauthRedirectOrigin,
        });
        router.push(`/oauth/authorize?${params.toString()}`);
      } else if (result.user.roles?.includes("superuser")) {
        router.push("/systems");
      } else {
        router.push("/entry");
      }
    } catch (err) {
      const msg = err instanceof Error
        ? err.message
        : "auth.login.error.invalid";
      if (
        msg.includes("2FA") || msg.includes("two-factor") ||
        msg.includes("twoFactor")
      ) {
        setShow2FA(true);
        setError("auth.login.error.twoFactorRequired");
      } else if (msg.includes("verify") || msg.includes("notVerified")) {
        setError("auth.login.error.notVerified");
      } else {
        setError(msg);
      }
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
        <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-2xl p-8 hover:shadow-lg hover:shadow-[var(--color-light-green)]/10 transition-all duration-300">
          <SystemBranding systemInfo={systemInfo} loading={brandingLoading} />

          <div className="mb-8 text-center">
            <h1 className="text-3xl font-bold bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent">
              {t("auth.login.title")}
            </h1>
            <p className="mt-2 text-[var(--color-light-text)]">
              {t("auth.login.subtitle")}
            </p>
          </div>

          <ErrorDisplay message={error} />

          <form onSubmit={handleSubmit} className="mt-6 space-y-5">
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-[var(--color-light-text)] mb-1"
              >
                {t("auth.login.email")}
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-3 text-white placeholder-white/30 outline-none focus:border-[var(--color-primary-green)] transition-colors"
                placeholder={t("common.placeholder.email")}
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-[var(--color-light-text)] mb-1"
              >
                {t("auth.login.password")}
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-3 text-white placeholder-white/30 outline-none focus:border-[var(--color-primary-green)] transition-colors"
                placeholder={t("common.placeholder.password")}
              />
            </div>

            {show2FA && (
              <div>
                <label
                  htmlFor="twoFactor"
                  className="block text-sm font-medium text-[var(--color-light-text)] mb-1"
                >
                  {t("auth.login.twoFactor")}
                </label>
                <input
                  id="twoFactor"
                  type="text"
                  value={twoFactorCode}
                  onChange={(e) => setTwoFactorCode(e.target.value)}
                  className="w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-3 text-white placeholder-white/30 outline-none focus:border-[var(--color-primary-green)] transition-colors"
                  placeholder={t("auth.login.twoFactor.placeholder")}
                />
              </div>
            )}

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm text-[var(--color-light-text)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={stayLoggedIn}
                  onChange={(e) => setStayLoggedIn(e.target.checked)}
                  className="rounded accent-[var(--color-primary-green)]"
                />
                {t("auth.login.stayLoggedIn")}
              </label>
              <Link
                href={`/forgot-password${systemParam}`}
                className="text-sm text-[var(--color-secondary-blue)] hover:text-[var(--color-primary-green)] transition-colors"
              >
                {t("auth.login.forgotPassword")}
              </Link>
            </div>

            <BotProtection onVerified={setBotToken} />

            <button
              type="submit"
              disabled={loading || !botToken}
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
              {t("auth.login.submit")}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-[var(--color-light-text)]">
            {t("auth.login.noAccount")}{" "}
            <Link
              href={`/register${systemParam}`}
              className="text-[var(--color-primary-green)] hover:text-[var(--color-light-green)] transition-colors font-medium"
            >
              {t("auth.login.register")}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[var(--color-black)]">
          <Spinner size="lg" />
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
