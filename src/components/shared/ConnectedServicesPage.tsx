"use client";

import { useCallback, useState } from "react";
import { useLocale } from "@/src/hooks/useLocale";
import { useAuth } from "@/src/hooks/useAuth";
import { useSystemContext } from "@/src/hooks/useSystemContext";
import GenericList from "@/src/components/shared/GenericList";
import Modal from "@/src/components/shared/Modal";
import Spinner from "@/src/components/shared/Spinner";
import ErrorDisplay from "@/src/components/shared/ErrorDisplay";
import type { CursorParams, PaginatedResult } from "@/src/contracts/common";

interface ConnectedService {
  id: string;
  name: string;
  userName?: string;
  createdAt: string;
  [key: string]: unknown;
}

export default function ConnectedServicesPage() {
  const { t } = useLocale();
  const { systemToken } = useAuth();
  const { companyId, systemId, roles } = useSystemContext();
  const isAdmin = roles.includes("admin") || roles.includes("superuser");

  const [connectOpen, setConnectOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ConnectedService | null>(
    null,
  );
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const fetchServices = useCallback(
    async (
      params: CursorParams & { search?: string },
    ): Promise<PaginatedResult<ConnectedService>> => {
      if (!systemToken || !companyId || !systemId) {
        return { data: [], nextCursor: null, prevCursor: null };
      }
      const p = new URLSearchParams({ companyId, systemId });
      if (params.search) p.set("search", params.search);
      if (params.cursor) p.set("cursor", params.cursor);
      p.set("limit", String(params.limit));
      const res = await fetch(`/api/connected-services?${p}`, {
        headers: { Authorization: `Bearer ${systemToken}` },
      });
      const json = await res.json();
      return {
        data: (json.data ?? []) as ConnectedService[],
        nextCursor: json.nextCursor ?? null,
        prevCursor: null,
      };
    },
    [systemToken, companyId, systemId],
  );

  const triggerReload = () => setReloadKey((k) => k + 1);

  const handleConnect = async (serviceName: string) => {
    if (!systemToken) return;
    setActionLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/connected-services", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${systemToken}`,
        },
        body: JSON.stringify({ name: serviceName }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error?.message ?? "common.error.generic");
        return;
      }
      setConnectOpen(false);
      triggerReload();
    } catch {
      setError("common.error.network");
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!systemToken || !deleteTarget) return;
    setActionLoading(true);
    try {
      const res = await fetch("/api/connected-services", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${systemToken}`,
        },
        body: JSON.stringify({ id: deleteTarget.id }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error?.message ?? "common.error.generic");
        return;
      }
      setDeleteTarget(null);
      triggerReload();
    } catch {
      setError("common.error.network");
    } finally {
      setActionLoading(false);
    }
  };

  const serviceCatalog: string[] = [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent">
          {t("common.menu.connectedServices")}
        </h1>
        <button
          onClick={() => {
            setError(null);
            setConnectOpen(true);
          }}
          className="rounded-lg bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] px-4 py-2 font-semibold text-black text-sm transition-all hover:opacity-90"
        >
          {t("common.connectedServices.connect")}
        </button>
      </div>

      <ErrorDisplay message={error} />

      <GenericList<ConnectedService>
        entityName={t("common.menu.connectedServices")}
        searchEnabled={false}
        createEnabled={false}
        controlButtons={[]}
        fetchFn={fetchServices}
        reloadKey={reloadKey}
        renderItem={(service) => (
          <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-4 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-[var(--color-light-green)]/10 transition-all duration-200">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <h3 className="font-semibold text-white">
                  {service.name}
                </h3>
                {isAdmin && service.userName && (
                  <p className="text-xs text-[var(--color-light-text)] mt-1">
                    {t("common.connectedServices.user")}: {service.userName}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-3">
                <span className="text-xs text-[var(--color-light-text)]">
                  {new Date(service.createdAt).toLocaleDateString()}
                </span>
                <button
                  onClick={() => {
                    setError(null);
                    setDeleteTarget(service);
                  }}
                  className="text-sm px-3 py-1 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  {t("common.delete")}
                </button>
              </div>
            </div>
          </div>
        )}
      />

      {/* Connect service modal */}
      <Modal
        open={connectOpen}
        onClose={() => {
          setConnectOpen(false);
          setError(null);
        }}
        title={t("common.connectedServices.connect")}
      >
        <div className="space-y-4">
          {serviceCatalog.length === 0
            ? (
              <div className="text-center py-6">
                <div className="text-4xl mb-3">🔗</div>
                <p className="text-[var(--color-light-text)]">
                  {t("common.connectedServices.catalogEmpty")}
                </p>
              </div>
            )
            : (
              <div className="space-y-2">
                {serviceCatalog.map((svc) => (
                  <button
                    key={svc}
                    onClick={() => handleConnect(svc)}
                    disabled={actionLoading}
                    className="w-full text-left rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-3 text-white hover:bg-white/10 transition-colors disabled:opacity-50"
                  >
                    {svc}
                  </button>
                ))}
              </div>
            )}
          <ErrorDisplay message={error} />
          <div className="flex justify-end">
            <button
              onClick={() => {
                setConnectOpen(false);
                setError(null);
              }}
              className="rounded-lg border border-[var(--color-dark-gray)] px-4 py-2 text-[var(--color-light-text)] hover:bg-white/5 transition-colors"
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete confirmation modal */}
      <Modal
        open={!!deleteTarget}
        onClose={() => {
          setDeleteTarget(null);
          setError(null);
        }}
        title={t("common.connectedServices.deleteTitle")}
      >
        <div className="space-y-4">
          <p className="text-[var(--color-light-text)] text-sm">
            {t("common.connectedServices.deleteDesc")}
          </p>
          <p className="font-semibold text-white">{deleteTarget?.name}</p>
          <ErrorDisplay message={error} />
          <div className="flex gap-3 justify-end">
            <button
              onClick={() => {
                setDeleteTarget(null);
                setError(null);
              }}
              className="rounded-lg border border-[var(--color-dark-gray)] px-4 py-2 text-[var(--color-light-text)] hover:bg-white/5 transition-colors"
            >
              {t("common.cancel")}
            </button>
            <button
              onClick={handleDelete}
              disabled={actionLoading}
              className="rounded-lg bg-red-500/80 px-4 py-2 text-white font-semibold hover:bg-red-500 transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {actionLoading && <Spinner size="sm" />}
              {t("common.delete")}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
