"use client";

import { useCallback, useState } from "react";
import { useLocale } from "@/src/hooks/useLocale";
import { useAuth } from "@/src/hooks/useAuth";
import { useSystemContext } from "@/src/hooks/useSystemContext";
import GenericList from "@/src/components/shared/GenericList";
import Modal from "@/src/components/shared/Modal";
import Spinner from "@/src/components/shared/Spinner";
import ErrorDisplay from "@/src/components/shared/ErrorDisplay";
import ResourceLimitsView, {
  type ResourceLimitsData,
} from "@/src/components/shared/ResourceLimitsView";
import type { CursorParams, PaginatedResult } from "@/src/contracts/common";

interface ConnectedApp {
  id: string;
  name: string;
  actorType: string;
  resourceLimitId?: ResourceLimitsData | null;
  createdAt: string;
  [key: string]: unknown;
}

export default function ConnectedAppsPage() {
  const { t } = useLocale();
  const { systemToken } = useAuth();
  const { companyId, systemId, systemSlug } = useSystemContext();

  const [revokeApp, setRevokeApp] = useState<ConnectedApp | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const fetchApps = useCallback(
    async (
      params: CursorParams & { search?: string },
    ): Promise<PaginatedResult<ConnectedApp>> => {
      if (!systemToken || !companyId || !systemId) {
        return { items: [], total: 0, hasMore: false };
      }
      const p = new URLSearchParams({ companyId, systemId, actorType: "app" });
      if (params.search) p.set("search", params.search);
      if (params.cursor) p.set("cursor", params.cursor);
      p.set("limit", String(params.limit));
      const res = await fetch(`/api/tokens?${p}`, {
        headers: { Authorization: `Bearer ${systemToken}` },
      });
      const json = await res.json();
      return {
        items: (json.items ?? json.data ?? []) as ConnectedApp[],
        total: json.total ?? 0,
        hasMore: json.hasMore ?? false,
        nextCursor: json.nextCursor,
      };
    },
    [systemToken, companyId, systemId],
  );

  const triggerReload = () => setReloadKey((k) => k + 1);

  const handleRevoke = async () => {
    if (!systemToken || !revokeApp) return;
    setActionLoading(true);
    try {
      const res = await fetch("/api/tokens", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${systemToken}`,
        },
        body: JSON.stringify({ id: revokeApp.id }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error?.message ?? "common.error.generic");
        return;
      }
      setRevokeApp(null);
      triggerReload();
    } catch {
      setError("common.error.network");
    } finally {
      setActionLoading(false);
    }
  };

  const authorizeUrl = typeof window !== "undefined"
    ? `${globalThis.location.origin}/oauth/authorize?systemSlug=${
      encodeURIComponent(systemSlug ?? "")
    }&client_name=YOUR_APP_NAME&roles=read:*&redirect_origin=https://yourapp.com`
    : "";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent">
          {t("common.menu.connectedApps")}
        </h1>
      </div>

      <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-primary-green)]/40 rounded-xl p-5 space-y-3">
        <h2 className="font-semibold text-[var(--color-primary-green)] flex items-center gap-2">
          🔌 {t("common.connectedApps.howTitle")}
        </h2>
        <p className="text-sm text-[var(--color-light-text)]">
          {t("common.connectedApps.howDesc")}
        </p>
        <ol className="text-sm text-[var(--color-light-text)] list-decimal list-inside space-y-1">
          <li>{t("common.connectedApps.step1")}</li>
          <li>{t("common.connectedApps.step2")}</li>
          <li>{t("common.connectedApps.step3")}</li>
          <li>{t("common.connectedApps.step4")}</li>
        </ol>
        <div className="mt-2">
          <p className="text-xs text-[var(--color-light-text)] mb-1 font-mono uppercase tracking-wide">
            {t("common.connectedApps.exampleUrl")}
          </p>
          <div className="bg-black/40 rounded-lg p-3 font-mono text-xs text-[var(--color-primary-green)] break-all select-all border border-[var(--color-dark-gray)]">
            {authorizeUrl}
          </div>
        </div>
      </div>

      <ErrorDisplay message={error} />

      <GenericList<ConnectedApp>
        entityName={t("common.menu.connectedApps")}
        searchEnabled={false}
        createEnabled={false}
        controlButtons={[]}
        fetchFn={fetchApps}
        reloadKey={reloadKey}
        renderItem={(app) => (
          <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-4 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-[var(--color-light-green)]/10 transition-all duration-200">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-white">{app.name}</h3>
                  <span className="text-xs bg-[var(--color-primary-green)]/20 text-[var(--color-primary-green)] px-2 py-0.5 rounded-full">
                    {t("common.connectedApps.authorized")}
                  </span>
                </div>
                {app.resourceLimitId && (
                  <ResourceLimitsView
                    data={app.resourceLimitId}
                    systemSlug={systemSlug ?? undefined}
                    className="mt-2"
                  />
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-3">
                <span className="text-xs text-[var(--color-light-text)]">
                  {new Date(app.createdAt).toLocaleDateString()}
                </span>
                <button
                  onClick={() => {
                    setError(null);
                    setRevokeApp(app);
                  }}
                  className="text-sm px-3 py-1 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  {t("common.connectedApps.revoke")}
                </button>
              </div>
            </div>
          </div>
        )}
      />

      {/* Revoke confirmation modal */}
      <Modal
        open={!!revokeApp}
        onClose={() => {
          setRevokeApp(null);
          setError(null);
        }}
        title={t("common.connectedApps.revokeTitle")}
      >
        <div className="space-y-4">
          <p className="text-[var(--color-light-text)] text-sm">
            {t("common.connectedApps.revokeDesc")}
          </p>
          <p className="font-semibold text-white">{revokeApp?.name}</p>
          <ErrorDisplay message={error} />
          <div className="flex gap-3 justify-end">
            <button
              onClick={() => {
                setRevokeApp(null);
                setError(null);
              }}
              className="rounded-lg border border-[var(--color-dark-gray)] px-4 py-2 text-[var(--color-light-text)] hover:bg-white/5 transition-colors"
            >
              {t("common.cancel")}
            </button>
            <button
              onClick={handleRevoke}
              disabled={actionLoading}
              className="rounded-lg bg-red-500/80 px-4 py-2 text-white font-semibold hover:bg-red-500 transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {actionLoading && <Spinner size="sm" />}
              {t("common.connectedApps.revoke")}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
