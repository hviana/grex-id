"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Spinner from "@/src/components/shared/Spinner";
import ErrorDisplay from "@/src/components/shared/ErrorDisplay";
import BotProtection from "@/src/components/shared/BotProtection";
import LocaleSelector from "@/src/components/shared/LocaleSelector";
import SystemBranding from "@/src/components/shared/SystemBranding";
import Link from "next/link";
import { useTenantContext } from "@/src/hooks/useTenantContext";

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const systemSlug = searchParams.get("systemSlug");
  const isOAuth = searchParams.get("oauth") === "1";
  const oauthClientName = searchParams.get("client_name") ?? "";
  const oauthRoles = searchParams.get("roles") ?? "";
  const oauthSystemSlug = searchParams.get("systemSlug") ?? systemSlug ?? "";
  const oauthRedirectOrigin = searchParams.get("redirect_origin") ?? "";
  const {
    login,
    t,
    publicSystem: systemInfo,
    publicSystemLoading: brandingLoading,
    loadPublicSystem,
  } = useTenantContext();
  useEffect(() => {
    loadPublicSystem(systemSlug ?? undefined);
  }, [systemSlug, loadPublicSystem]);

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [stayLoggedIn, setStayLoggedIn] = useState(false);
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [show2FA, setShow2FA] = useState(false);
  const [botToken, setBotToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loginLinkLoading, setLoginLinkLoading] = useState(false);
  const [loginLinkSent, setLoginLinkSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const systemParam = systemSlug
    ? `?systemSlug=${encodeURIComponent(systemSlug)}`
    : "";
  const verifyParams = new URLSearchParams();
  if (systemSlug) {
    verifyParams.set("systemSlug", systemSlug);
  }
  if (identifier) {
    verifyParams.set("identifier", identifier);
  }
  const verifyHref = `/verify${
    verifyParams.toString() ? `?${verifyParams.toString()}` : ""
  }`;

  const handleLoginLink = async () => {
    if (!identifier || !password) return;
    setLoginLinkLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/two-factor/login-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier,
          password,
          stayLoggedIn,
        }),
      });
      // Always generic success by design (anti-enumeration).
      await res.json().catch(() => ({}));
      setLoginLinkSent(true);
    } finally {
      setLoginLinkLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!botToken) return;
    setLoading(true);
    setError(null);

    try {
      const result = await login(
        identifier,
        password,
        stayLoggedIn,
        twoFactorCode || undefined,
      );
      if (isOAuth && oauthClientName) {
        // Redirect to OAuth authorization page preserving all params
        const params = new URLSearchParams({
          client_name: oauthClientName,
          roles: oauthRoles,
          systemSlug: oauthSystemSlug,
          redirect_origin: oauthRedirectOrigin,
        });
        router.push(`/oauth/authorize?${params.toString()}`);
      } else if (result.systemToken) {
        const payload = JSON.parse(
          atob(
            result.systemToken.split(".")[1].replace(/-/g, "+").replace(
              /_/g,
              "/",
            ),
          ),
        );
        if ((payload.roles as string[])?.includes("superuser")) {
          router.push("/systems");
        } else {
          router.push("/entry");
        }
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
          {error === "auth.login.error.notVerified" && (
            <div className="mt-4 text-center text-sm">
              <Link
                href={verifyHref}
                className="text-[var(--color-secondary-blue)] transition-colors hover:text-[var(--color-primary-green)]"
              >
                {t("auth.verify.resend")}
              </Link>
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-6 space-y-5">
            <div>
              <label
                htmlFor="identifier"
                className="block text-sm font-medium text-[var(--color-light-text)] mb-1"
              >
                {t("auth.login.identifier")}
              </label>
              <input
                id="identifier"
                type="text"
                autoComplete="username"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
                className="w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-3 text-white placeholder-white/30 outline-none focus:border-[var(--color-primary-green)] transition-colors"
                placeholder={t("common.placeholder.entityChannel")}
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
              <div className="space-y-3">
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
                {loginLinkSent
                  ? (
                    <p className="text-sm text-[var(--color-primary-green)]">
                      {t("common.twoFactor.loginLink.sent")}
                    </p>
                  )
                  : (
                    <button
                      type="button"
                      onClick={handleLoginLink}
                      disabled={loginLinkLoading || !identifier || !password}
                      className="text-sm text-[var(--color-secondary-blue)] hover:text-[var(--color-primary-green)] transition-colors inline-flex items-center gap-2 disabled:opacity-50"
                    >
                      {loginLinkLoading && <Spinner size="sm" />}
                      {t("common.twoFactor.loginLink.cta")}
                    </button>
                  )}
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
