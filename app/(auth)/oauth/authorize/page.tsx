"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/src/hooks/useAuth";
import { useLocale } from "@/src/hooks/useLocale";
import Spinner from "@/src/components/shared/Spinner";
import ErrorDisplay from "@/src/components/shared/ErrorDisplay";
import LocaleSelector from "@/src/components/shared/LocaleSelector";
import TranslatedBadgeList from "@/src/components/shared/TranslatedBadgeList";

function OAuthAuthorizeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { systemToken, user, loading: authLoading } = useAuth();
  const { t } = useLocale();

  const clientName = searchParams.get("client_name") ?? "";
  const permissionsParam = searchParams.get("permissions") ?? "";
  const systemSlug = searchParams.get("systemSlug") ?? "";
  const redirectOrigin = searchParams.get("redirect_origin") ?? "";

  const permissions = permissionsParam
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  const [companies, setCompanies] = useState<{ id: string; name: string }[]>(
    [],
  );
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [loadingCompanies, setLoadingCompanies] = useState(false);
  const [authorizing, setAuthorizing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Redirect to login if not authenticated, preserving OAuth params
  useEffect(() => {
    if (authLoading) return;
    if (!systemToken || !user) {
      const params = new URLSearchParams({
        oauth: "1",
        client_name: clientName,
        permissions: permissionsParam,
        systemSlug: systemSlug,
        redirect_origin: redirectOrigin,
      });
      router.replace(`/login?${params.toString()}`);
    }
  }, [
    authLoading,
    systemToken,
    user,
    router,
    clientName,
    permissionsParam,
    systemSlug,
    redirectOrigin,
  ]);

  // Load user's companies
  const loadCompanies = useCallback(async () => {
    if (!systemToken) return;
    setLoadingCompanies(true);
    try {
      const res = await fetch("/api/companies", {
        headers: { Authorization: `Bearer ${systemToken}` },
      });
      const json = await res.json();
      if (json.success) {
        const list = json.data ?? [];
        setCompanies(list);
        if (list.length > 0) setSelectedCompanyId(list[0].id);
      }
    } catch {
      setError("common.error.network");
    } finally {
      setLoadingCompanies(false);
    }
  }, [systemToken]);

  useEffect(() => {
    if (systemToken && user) loadCompanies();
  }, [systemToken, user, loadCompanies]);

  const sendMessageAndClose = (data: Record<string, unknown>) => {
    if (redirectOrigin && globalThis.opener) {
      try {
        globalThis.opener.postMessage(data, redirectOrigin);
      } catch {
        // cross-origin postMessage failed — opener may have a different origin
      }
    }
    globalThis.close();
  };

  const handleAuthorize = async () => {
    if (!systemToken || !selectedCompanyId) return;
    setAuthorizing(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/oauth/authorize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${systemToken}`,
        },
        body: JSON.stringify({
          clientName,
          permissions: permissionsParam,
          systemSlug,
          companyId: selectedCompanyId,
          redirectOrigin,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error?.message ?? "common.error.generic");
        return;
      }
      sendMessageAndClose({ token: json.data.token, app: json.data.app });
    } catch {
      setError("common.error.network");
    } finally {
      setAuthorizing(false);
    }
  };

  const handleDeny = () => {
    sendMessageAndClose({ error: "access_denied" });
  };

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--color-black)]">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!systemToken || !user) return null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[var(--color-black)] via-[#0a0a0a] to-[#111] px-4">
      <div className="absolute top-4 right-4">
        <LocaleSelector />
      </div>

      <div className="w-full max-w-md">
        <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-2xl p-8 space-y-6 hover:shadow-lg hover:shadow-[var(--color-light-green)]/10 transition-all duration-300">
          {/* App icon + name */}
          <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-[var(--color-primary-green)]/20 to-[var(--color-secondary-blue)]/20 border border-[var(--color-dark-gray)] flex items-center justify-center text-3xl">
              🔌
            </div>
            <h1 className="text-xl font-bold text-white">
              <span className="bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent">
                {clientName || t("common.connectedApps.unknownApp")}
              </span>
            </h1>
            <p className="mt-1 text-sm text-[var(--color-light-text)]">
              {t("common.connectedApps.oauthRequest")}
            </p>
          </div>

          {/* Permissions */}
          <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-4 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-light-text)]">
              {t("common.connectedApps.requestedPermissions")}
            </p>
            <TranslatedBadgeList
              kind="permission"
              tokens={permissions}
              systemSlug={systemSlug || undefined}
              compact
              mode="column"
              prefix={
                <span className="text-[var(--color-primary-green)]">✓</span>
              }
              emptyText={t("common.connectedApps.noPermissions")}
            />
          </div>

          {/* Company selector */}
          {loadingCompanies
            ? (
              <div className="flex justify-center py-2">
                <Spinner size="sm" />
              </div>
            )
            : companies.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-[var(--color-light-text)] mb-2">
                  {t("common.connectedApps.selectCompany")}
                </label>
                <select
                  value={selectedCompanyId}
                  onChange={(e) => setSelectedCompanyId(e.target.value)}
                  className="w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-2.5 text-white outline-none focus:border-[var(--color-primary-green)] transition-colors"
                >
                  {companies.map((c) => (
                    <option
                      key={c.id}
                      value={c.id}
                      className="bg-[#111] text-white"
                    >
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

          <ErrorDisplay message={error} />

          {/* Authorizing user info */}
          <p className="text-xs text-center text-[var(--color-light-text)]">
            {t("common.connectedApps.authorizedAs")}{" "}
            <span className="text-white font-medium">
              {user.profile?.name ??
                (user.channels?.find((c) => c.type === "email")
                  ?.value ??
                  "")}
            </span>
          </p>

          {/* Action buttons */}
          <div className="flex gap-3">
            <button
              onClick={handleDeny}
              className="flex-1 rounded-lg border border-[var(--color-dark-gray)] px-4 py-3 text-[var(--color-light-text)] hover:bg-white/5 transition-colors font-medium"
            >
              {t("common.cancel")}
            </button>
            <button
              onClick={handleAuthorize}
              disabled={authorizing || !selectedCompanyId}
              className="flex-1 rounded-lg bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] px-4 py-3 font-semibold text-black transition-all hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {authorizing && (
                <Spinner
                  size="sm"
                  className="border-black border-t-transparent"
                />
              )}
              {t("common.connectedApps.authorize")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function OAuthAuthorizePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[var(--color-black)]">
          <Spinner size="lg" />
        </div>
      }
    >
      <OAuthAuthorizeContent />
    </Suspense>
  );
}
