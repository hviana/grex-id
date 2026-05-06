"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Spinner from "@/src/components/shared/Spinner";
import ErrorDisplay from "@/src/components/shared/ErrorDisplay";
import LocaleSelector from "@/src/components/shared/LocaleSelector";
import TenantView from "@/src/components/shared/TenantView";
import type { TenantViewData } from "@/src/contracts/high-level/tenant-display";
import ResourceLimitsView from "@/src/components/shared/ResourceLimitsView";
import type { ResourceLimitsData } from "@/src/contracts/high-level/resource-limits";
import { useTenantContext } from "@/src/hooks/useTenantContext";

/** resource_limit fields that may appear in OAuth URL params and POST body. */
const RESOURCE_LIMIT_FIELDS = [
  "roleIds",
  "entityLimits",
  "apiRateLimit",
  "storageLimitBytes",
  "fileCacheLimitBytes",
  "credits",
  "maxConcurrentDownloads",
  "maxConcurrentUploads",
  "maxDownloadBandwidthMB",
  "maxUploadBandwidthMB",
  "maxOperationCountByResourceKey",
  "creditLimitByResourceKey",
  "frontendDomains",
] as const;

function parseJsonParam(raw: string | null): unknown | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function parseNumParam(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function parseCsvParam(raw: string | null): string[] | undefined {
  if (!raw) return undefined;
  const arr = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return arr.length > 0 ? arr : undefined;
}

function OAuthAuthorizeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    systemToken,
    user,
    loading: authLoading,
    t,
  } = useTenantContext();

  const clientName = searchParams.get("client_name") ?? "";
  const systemSlug = searchParams.get("systemSlug") ?? "";
  const redirectOrigin = searchParams.get("redirect_origin") ?? "";

  // Build resource-limits data from URL params using exact field names.
  const requestedLimits = useMemo<ResourceLimitsData>(() => {
    const rl: ResourceLimitsData = {};
    const roleIds = parseCsvParam(searchParams.get("roleIds"));
    if (roleIds) rl.roleIds = roleIds;
    const entityLimits = parseJsonParam(searchParams.get("entityLimits"));
    if (entityLimits && typeof entityLimits === "object") {
      rl.entityLimits = entityLimits as Record<string, number>;
    }
    const apiRateLimit = parseNumParam(searchParams.get("apiRateLimit"));
    if (apiRateLimit != null) rl.apiRateLimit = apiRateLimit;
    const storageLimitBytes = parseNumParam(
      searchParams.get("storageLimitBytes"),
    );
    if (storageLimitBytes != null) rl.storageLimitBytes = storageLimitBytes;
    const fileCacheLimitBytes = parseNumParam(
      searchParams.get("fileCacheLimitBytes"),
    );
    if (fileCacheLimitBytes != null) {
      rl.fileCacheLimitBytes = fileCacheLimitBytes;
    }
    const credits = parseNumParam(searchParams.get("credits"));
    if (credits != null) rl.credits = credits;
    const maxConcurrentDownloads = parseNumParam(
      searchParams.get("maxConcurrentDownloads"),
    );
    if (maxConcurrentDownloads != null) {
      rl.maxConcurrentDownloads = maxConcurrentDownloads;
    }
    const maxConcurrentUploads = parseNumParam(
      searchParams.get("maxConcurrentUploads"),
    );
    if (maxConcurrentUploads != null) {
      rl.maxConcurrentUploads = maxConcurrentUploads;
    }
    const maxDownloadBandwidthMB = parseNumParam(
      searchParams.get("maxDownloadBandwidthMB"),
    );
    if (maxDownloadBandwidthMB != null) {
      rl.maxDownloadBandwidthMB = maxDownloadBandwidthMB;
    }
    const maxUploadBandwidthMB = parseNumParam(
      searchParams.get("maxUploadBandwidthMB"),
    );
    if (maxUploadBandwidthMB != null) {
      rl.maxUploadBandwidthMB = maxUploadBandwidthMB;
    }
    const maxOp = parseJsonParam(
      searchParams.get("maxOperationCountByResourceKey"),
    );
    if (maxOp && typeof maxOp === "object") {
      rl.maxOperationCountByResourceKey = maxOp as Record<string, number>;
    }
    const creditLim = parseJsonParam(
      searchParams.get("creditLimitByResourceKey"),
    );
    if (creditLim && typeof creditLim === "object") {
      rl.creditLimitByResourceKey = creditLim as Record<string, number>;
    }
    const frontendDomains = parseCsvParam(
      searchParams.get("frontendDomains"),
    );
    if (frontendDomains) rl.frontendDomains = frontendDomains;
    return rl;
  }, [searchParams]);

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
        systemSlug: systemSlug,
        redirect_origin: redirectOrigin,
      });
      for (const field of RESOURCE_LIMIT_FIELDS) {
        const v = searchParams.get(field);
        if (v) params.set(field, v);
      }
      router.replace(`/login?${params.toString()}`);
    }
  }, [
    authLoading,
    systemToken,
    user,
    router,
    clientName,
    systemSlug,
    redirectOrigin,
    searchParams,
  ]);

  const [systemName, setSystemName] = useState("");

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

  // Load system name from the target system slug
  useEffect(() => {
    if (!systemSlug) {
      setSystemName("");
      return;
    }
    let cancelled = false;
    fetch(`/api/public/system?slug=${encodeURIComponent(systemSlug)}`)
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled && json.success && json.data?.name) {
          setSystemName(json.data.name);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [systemSlug]);

  // Build TenantViewData for the app's requested authorization scope
  const tenantViewData = useMemo<TenantViewData | null>(() => {
    const company = companies.find((c) => c.id === selectedCompanyId);
    return {
      id: "",
      systemSlug: systemSlug || undefined,
      systemName: systemName || undefined,
      companyId: selectedCompanyId || undefined,
      companyName: company?.name,
      actorName: clientName || undefined,
      actorType: "api_token",
      roles: (requestedLimits as Record<string, unknown>).roleIds as
        | string[]
        | undefined,
    };
  }, [
    companies,
    selectedCompanyId,
    systemSlug,
    systemName,
    clientName,
    requestedLimits,
  ]);

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
      const body: Record<string, unknown> = {
        clientName,
        systemSlug,
        companyId: selectedCompanyId,
        redirectOrigin,
      };
      for (const field of RESOURCE_LIMIT_FIELDS) {
        const v = (requestedLimits as Record<string, unknown>)[field];
        if (v != null) body[field] = v;
      }
      const res = await fetch("/api/auth/oauth/authorize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${systemToken}`,
        },
        body: JSON.stringify(body),
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

  const hasLimits = Object.keys(requestedLimits).length > 0;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[var(--color-black)] via-[#0a0a0a] to-[#111] px-4 py-8">
      <div className="absolute top-4 right-4">
        <LocaleSelector />
      </div>

      <div className="w-full max-w-lg">
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

          {/* Requested authorization scope */}
          {tenantViewData && (
            <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-light-text)] mb-2">
                {t("common.connectedApps.requestedRoles")}
              </p>
              <TenantView tenant={tenantViewData} compact />
            </div>
          )}

          {/* Requested resource limits */}
          {hasLimits && (
            <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-light-text)] mb-2">
                {t("common.connectedApps.requestedResources")}
              </p>
              <ResourceLimitsView
                data={requestedLimits}
                systemSlug={systemSlug || undefined}
              />
            </div>
          )}

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

          {/* Authorizing user */}
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
