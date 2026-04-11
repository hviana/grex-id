"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/src/hooks/useLocale";
import { useAuth } from "@/src/hooks/useAuth";
import { useSystemContext } from "@/src/hooks/useSystemContext";
import Spinner from "@/src/components/shared/Spinner";
import Modal from "@/src/components/shared/Modal";
import ErrorDisplay from "@/src/components/shared/ErrorDisplay";

interface ConnectedApp {
  id: string;
  name: string;
  permissions: string[];
  monthlySpendLimit?: number;
  createdAt: string;
}

export default function ConnectedAppsPage() {
  const { t } = useLocale();
  const { systemToken } = useAuth();
  const { companyId, systemId, systemSlug } = useSystemContext();

  const [apps, setApps] = useState<ConnectedApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [revokeApp, setRevokeApp] = useState<ConnectedApp | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadApps = useCallback(async () => {
    if (!systemToken || !companyId || !systemId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ companyId, systemId });
      const res = await fetch(`/api/connected-apps?${params}`, {
        headers: { Authorization: `Bearer ${systemToken}` },
      });
      const json = await res.json();
      if (json.success) setApps(json.data ?? []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [systemToken, companyId, systemId]);

  useEffect(() => {
    loadApps();
  }, [loadApps]);

  const handleRevoke = async () => {
    if (!systemToken || !revokeApp) return;
    setActionLoading(true);
    try {
      const res = await fetch("/api/connected-apps", {
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
      await loadApps();
    } catch {
      setError("common.error.network");
    } finally {
      setActionLoading(false);
    }
  };

  // Build the OAuth authorize URL so external developers can copy it
  const authorizeUrl = typeof window !== "undefined"
    ? `${globalThis.location.origin}/oauth/authorize?system_slug=${
      encodeURIComponent(systemSlug ?? "")
    }&client_name=YOUR_APP_NAME&permissions=read:*&redirect_origin=https://yourapp.com`
    : "";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent">
          {t("common.menu.connectedApps")}
        </h1>
      </div>

      {/* How to connect info box */}
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

      {loading
        ? (
          <div className="flex justify-center py-8">
            <Spinner size="lg" />
          </div>
        )
        : apps.length === 0
        ? (
          <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-8 text-center">
            <div className="text-4xl mb-3">🔗</div>
            <p className="text-[var(--color-light-text)]">
              {t("common.connectedApps.empty")}
            </p>
          </div>
        )
        : (
          <div className="space-y-3">
            {apps.map((app) => (
              <div
                key={app.id}
                className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-4 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-[var(--color-light-green)]/10 transition-all duration-200"
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-white">{app.name}</h3>
                      <span className="text-xs bg-[var(--color-primary-green)]/20 text-[var(--color-primary-green)] px-2 py-0.5 rounded-full">
                        {t("common.connectedApps.authorized")}
                      </span>
                    </div>
                    <div className="flex gap-1 flex-wrap mt-2">
                      {app.permissions.map((perm) => (
                        <span
                          key={perm}
                          className="text-xs bg-[var(--color-secondary-blue)]/20 text-[var(--color-secondary-blue)] px-2 py-0.5 rounded-full"
                        >
                          {perm}
                        </span>
                      ))}
                    </div>
                    {app.monthlySpendLimit != null && (
                      <p className="text-xs text-[var(--color-light-text)] mt-1">
                        {t("common.connectedApps.spendLimit")}:{" "}
                        {app.monthlySpendLimit.toLocaleString()}
                      </p>
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
            ))}
          </div>
        )}

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
