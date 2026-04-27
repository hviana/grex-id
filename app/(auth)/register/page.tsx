"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Spinner from "@/src/components/shared/Spinner";
import ErrorDisplay from "@/src/components/shared/ErrorDisplay";
import BotProtection from "@/src/components/shared/BotProtection";
import LocaleSelector from "@/src/components/shared/LocaleSelector";
import SystemBranding from "@/src/components/shared/SystemBranding";
import EntityChannelsSubform from "@/src/components/subforms/EntityChannelsSubform";
import type { SubformRef } from "@/src/components/shared/GenericList";
import Link from "next/link";
import { useTenantContext } from "@/src/hooks/useTenantContext";

function RegisterContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const systemSlug = searchParams.get("systemSlug");
  const { t, locale, publicSystem: systemInfo, publicSystemLoading: brandingLoading, loadPublicSystem } = useTenantContext();
  useEffect(() => { loadPublicSystem(systemSlug ?? undefined); }, [systemSlug, loadPublicSystem]);

  const channelsRef = useRef<SubformRef>(null);

  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [botToken, setBotToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const systemParam = systemSlug
    ? `?systemSlug=${encodeURIComponent(systemSlug)}`
    : "";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!botToken) return;

    if (password !== confirmPassword) {
      setError("auth.register.error.passwordMismatch");
      return;
    }

    const collected = (channelsRef.current?.getData() ?? {}) as {
      channels?: { type: string; value: string }[];
    };
    const channels = collected.channels ?? [];
    if (channels.length === 0) {
      setError("validation.channel.required");
      return;
    }
    if (!channelsRef.current?.isValid()) {
      setError("validation.channel.requiredTypes");
      return;
    }

    setLoading(true);
    setError(null);
    setErrors([]);

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          channels,
          password,
          confirmPassword,
          termsAccepted,
          botToken,
          locale,
          systemSlug: systemSlug || undefined,
        }),
      });
      const json = await res.json();

      if (!json.success) {
        if (json.error?.errors && json.error.errors.length > 0) {
          setErrors(json.error.errors);
        } else {
          setError(json.error?.message ?? "common.error.generic");
        }
        return;
      }

      const verifyParams = new URLSearchParams();
      if (systemSlug) {
        verifyParams.set("systemSlug", systemSlug);
      }
      // Prefill the verify/resend form with any channel value submitted —
      // prefer email for convenience, else the first channel regardless.
      const primaryIdentifier = channels.find((c) =>
        c.type === "email"
      )?.value ?? channels[0]?.value;
      if (primaryIdentifier) {
        verifyParams.set("identifier", primaryIdentifier);
      }
      router.push(
        `/verify${
          verifyParams.toString() ? `?${verifyParams.toString()}` : ""
        }`,
      );
    } catch {
      setError("common.error.network");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[var(--color-black)] via-[#0a0a0a] to-[#111] px-4 py-8">
      <div className="absolute top-4 right-4">
        <LocaleSelector />
      </div>

      <div className="w-full max-w-md">
        <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-2xl p-8 hover:shadow-lg hover:shadow-[var(--color-light-green)]/10 transition-all duration-300">
          <SystemBranding systemInfo={systemInfo} loading={brandingLoading} />

          <div className="mb-8 text-center">
            <h1 className="text-3xl font-bold bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent">
              {t("auth.register.title")}
            </h1>
            <p className="mt-2 text-[var(--color-light-text)]">
              {t("auth.register.subtitle")}
            </p>
          </div>

          <ErrorDisplay message={error} errors={errors} />

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label
                htmlFor="name"
                className="block text-sm font-medium text-[var(--color-light-text)] mb-1"
              >
                {t("auth.register.name")}
              </label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-3 text-white placeholder-white/30 outline-none focus:border-[var(--color-primary-green)] transition-colors"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
                {t("auth.register.channels")}
              </label>
              <EntityChannelsSubform
                ref={channelsRef}
                mode="local"
                channelTypes={["email", "phone"]}
                requiredTypes={["email"]}
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-[var(--color-light-text)] mb-1"
              >
                {t("auth.register.password")}
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                className="w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-3 text-white placeholder-white/30 outline-none focus:border-[var(--color-primary-green)] transition-colors"
              />
            </div>

            <div>
              <label
                htmlFor="confirmPassword"
                className="block text-sm font-medium text-[var(--color-light-text)] mb-1"
              >
                {t("auth.register.confirmPassword")}
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-3 text-white placeholder-white/30 outline-none focus:border-[var(--color-primary-green)] transition-colors"
              />
            </div>

            <BotProtection onVerified={setBotToken} />

            {/* Terms of Service (LGPD) */}
            <div className="space-y-2">
              {systemInfo?.termsOfService
                ? (
                  <div
                    className="max-h-32 overflow-y-auto rounded-lg border border-[var(--color-dark-gray)] bg-white/5 p-3 text-xs text-[var(--color-light-text)] whitespace-pre-wrap text-left"
                    dangerouslySetInnerHTML={{
                      __html: systemInfo.termsOfService,
                    }}
                  />
                )
                : (
                  <p className="text-xs text-[var(--color-light-text)]">
                    {t("common.terms.title")}
                  </p>
                )}
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={termsAccepted}
                  onChange={(e) => setTermsAccepted(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-[var(--color-dark-gray)] bg-white/5 accent-[var(--color-primary-green)]"
                />
                <span className="text-sm text-[var(--color-light-text)]">
                  {t("auth.register.termsAccept")}
                </span>
              </label>
              <a
                href={`/terms${systemParam}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block text-sm text-[var(--color-primary-green)] hover:text-[var(--color-light-green)] transition-colors font-medium underline underline-offset-2"
              >
                {t("common.terms.viewFull")}
              </a>
            </div>

            <button
              type="submit"
              disabled={loading || !botToken || !termsAccepted}
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
              {t("auth.register.submit")}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-[var(--color-light-text)]">
            {t("auth.register.hasAccount")}{" "}
            <Link
              href={`/login${systemParam}`}
              className="text-[var(--color-primary-green)] hover:text-[var(--color-light-green)] transition-colors font-medium"
            >
              {t("auth.register.login")}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[var(--color-black)]">
          <Spinner size="lg" />
        </div>
      }
    >
      <RegisterContent />
    </Suspense>
  );
}
