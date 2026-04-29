"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import GenericList from "@/src/components/shared/GenericList";
import Modal from "@/src/components/shared/Modal";
import Spinner from "@/src/components/shared/Spinner";
import ErrorDisplay from "@/src/components/shared/ErrorDisplay";
import TenantView from "@/src/components/shared/TenantView";
import type { TenantViewData } from "@/src/components/shared/TenantView";
import TenantSubform from "@/src/components/subforms/TenantSubform";
import ResourceLimitsSubform from "@/src/components/subforms/ResourceLimitsSubform";
import ResourceLimitsView, {
  type ResourceLimitsData,
} from "@/src/components/shared/ResourceLimitsView";
import type { SubformRef } from "@/src/components/shared/GenericList";
import type {
  CursorParams,
  PaginatedResult,
} from "@/src/contracts/high_level/pagination";
import { useTenantContext } from "@/src/hooks/useTenantContext";

interface ApiToken {
  id: string;
  name: string;
  description?: string;
  actorType: "app" | "token";
  resourceLimitId?: ResourceLimitsData | null;
  neverExpires?: boolean;
  expiresAt?: string;
  createdAt: string;
  [key: string]: unknown;
}

export default function TokensPage() {
  const {
    t,
    systemToken,
    companyId,
    systemId,
    systemSlug,
    companies,
    systems,
  } = useTenantContext();

  const companyName = useMemo(
    () => companies.find((c) => c.id === companyId)?.name,
    [companies, companyId],
  );
  const systemName = useMemo(
    () => systems.find((s) => s.id === systemId)?.name,
    [systems, systemId],
  );

  const [createOpen, setCreateOpen] = useState(false);
  const [deleteToken, setDeleteToken] = useState<ApiToken | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [createdRawToken, setCreatedRawToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newActorType, setNewActorType] = useState<"app" | "token">("token");
  const [newExpiry, setNewExpiry] = useState("");

  const limitsRef = useRef<SubformRef>(null);
  const tenantRef = useRef<SubformRef>(null);

  function buildTokenTenantView(token: ApiToken): TenantViewData {
    return {
      id: token.id,
      companyId: companyId ?? undefined,
      companyName,
      systemId: systemId ?? undefined,
      systemName,
      systemSlug: systemSlug ?? undefined,
      actorId: token.id,
      actorName: token.name,
      actorType: token.actorType === "app" ? "api_token" : "api_token",
      roles: token.resourceLimitId?.roleIds ?? undefined,
    };
  }

  const fetchTokens = useCallback(
    async (
      params: CursorParams & { search?: string },
    ): Promise<PaginatedResult<ApiToken>> => {
      if (!systemToken || !companyId) {
        return { items: [], total: 0, hasMore: false };
      }
      const p = new URLSearchParams({ companyId });
      if (systemId) p.set("systemId", systemId);
      if (params.search) p.set("search", params.search);
      if (params.cursor) p.set("cursor", params.cursor);
      p.set("limit", String(params.limit));
      const res = await fetch(`/api/tokens?${p}`, {
        headers: { Authorization: `Bearer ${systemToken}` },
      });
      const json = await res.json();
      return {
        items: (json.data ?? []) as ApiToken[],
        total: 0,
        hasMore: false,
      };
    },
    [systemToken, companyId, systemId],
  );

  const triggerReload = () => setReloadKey((k) => k + 1);

  const resetCreateForm = () => {
    setNewName("");
    setNewDesc("");
    setNewActorType("token");
    setNewExpiry("");
    setError(null);
  };

  const fetchSystemRoles = useCallback(async (search: string) => {
    if (!systemId) return [];
    try {
      const res = await fetch(
        `/api/core/roles?systemId=${encodeURIComponent(systemId)}&limit=100`,
      );
      const json = await res.json();
      const roles: { name: string }[] = json.data ?? [];
      const lower = search.toLowerCase();
      return roles
        .filter((r) => r.name.toLowerCase().includes(lower))
        .map((r) => r.name);
    } catch {
      return [];
    }
  }, [systemId]);

  const handleCreate = async () => {
    if (!systemToken || !companyId || !systemId || !newName.trim()) {
      return;
    }
    setActionLoading(true);
    setError(null);
    try {
      const limitsData = limitsRef.current?.getData() ?? {};
      const tenantData = tenantRef.current?.getData() ?? {};

      if (tenantData.roles) {
        limitsData.roleIds = tenantData.roles;
      }

      const res = await fetch("/api/tokens", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${systemToken}`,
        },
        body: JSON.stringify({
          name: newName.trim(),
          description: newDesc || undefined,
          actorType: newActorType,
          companyId,
          systemId,
          resourceLimits: limitsData,
          expiresAt: newExpiry || undefined,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error?.message ?? "common.error.generic");
        return;
      }
      setCreatedRawToken(json.data.token);
      setCreateOpen(false);
      resetCreateForm();
      triggerReload();
    } catch {
      setError("common.error.network");
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!systemToken || !deleteToken) return;
    setActionLoading(true);
    try {
      await fetch("/api/tokens", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${systemToken}`,
        },
        body: JSON.stringify({ id: deleteToken.id }),
      });
      setDeleteToken(null);
      triggerReload();
    } catch {
      setError("common.error.network");
    } finally {
      setActionLoading(false);
    }
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  const inputCls =
    "w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-3 text-white placeholder-white/30 outline-none focus:border-[var(--color-primary-green)] transition-colors";

  const actorTypeLabel = (at: string) =>
    at === "app"
      ? t("common.tokens.actorTypeApp")
      : t("common.tokens.actorTypeToken");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent">
          {t("common.menu.tokens")}
        </h1>
        <button
          onClick={() => {
            resetCreateForm();
            setCreateOpen(true);
          }}
          className="rounded-lg bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] px-4 py-2 font-semibold text-black text-sm transition-all hover:opacity-90"
        >
          {t("common.tokens.create")}
        </button>
      </div>

      <GenericList<ApiToken>
        entityName={t("common.menu.tokens")}
        searchEnabled={false}
        createEnabled={false}
        controlButtons={[]}
        fetchFn={fetchTokens}
        reloadKey={reloadKey}
        renderItem={(token) => (
          <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-4 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-[var(--color-light-green)]/10 transition-all duration-200 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-white">{token.name}</h3>
                <span className="text-xs bg-[var(--color-secondary-blue)]/20 text-[var(--color-secondary-blue)] px-2 py-0.5 rounded-full">
                  {actorTypeLabel(token.actorType)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {token.expiresAt && (
                  <span className="text-xs text-[var(--color-light-text)]">
                    {t("common.expires")}:{" "}
                    {new Date(token.expiresAt).toLocaleDateString()}
                  </span>
                )}
                <button
                  onClick={() => setDeleteToken(token)}
                  className="text-sm px-2 py-1 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  🗑️
                </button>
              </div>
            </div>
            {token.description && (
              <p className="text-sm text-[var(--color-light-text)]">
                {token.description}
              </p>
            )}

            <div className="border-t border-dashed border-[var(--color-dark-gray)]" />

            <TenantView
              tenant={buildTokenTenantView(token)}
              visibleFields={["roles"]}
              compact
            />

            {token.resourceLimitId && (
              <ResourceLimitsView
                data={token.resourceLimitId}
                systemSlug={systemSlug ?? undefined}
              />
            )}
          </div>
        )}
      />

      {/* Create modal */}
      <Modal
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          resetCreateForm();
        }}
        title={t("common.tokens.create")}
      >
        <div className="space-y-4">
          <TenantView
            tenant={{
              id: "",
              companyId: companyId ?? undefined,
              companyName,
              systemId: systemId ?? undefined,
              systemName,
              systemSlug: systemSlug ?? undefined,
              actorType: newActorType === "app" ? "api_token" : "api_token",
            }}
            visibleFields={[
              "companyId",
              "systemId",
              "actorType",
            ]}
            compact
          />

          <ErrorDisplay message={error} />

          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t("common.name") + " *"}
            className={inputCls}
          />
          <input
            type="text"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            placeholder={t("common.description")}
            className={inputCls}
          />
          <div>
            <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
              {t("common.tokens.actorType")} *
            </label>
            <select
              value={newActorType}
              onChange={(e) =>
                setNewActorType(e.target.value as "app" | "token")}
              className={inputCls}
            >
              <option value="token">{actorTypeLabel("token")}</option>
              <option value="app">{actorTypeLabel("app")}</option>
            </select>
          </div>
          <TenantSubform
            ref={tenantRef}
            visibleFields={["roles"]}
          />

          <ResourceLimitsSubform
            ref={limitsRef}
            valueMode="absolute"
            systemSlug={systemSlug ?? undefined}
          />
          <input
            type="date"
            value={newExpiry}
            onChange={(e) => setNewExpiry(e.target.value)}
            className={inputCls}
          />
          <button
            onClick={handleCreate}
            disabled={actionLoading || !newName.trim()}
            className="w-full rounded-lg bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] px-4 py-3 font-semibold text-black transition-all hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {actionLoading && (
              <Spinner
                size="sm"
                className="border-black border-t-transparent"
              />
            )}
            {t("common.create")}
          </button>
        </div>
      </Modal>

      {/* Raw token display modal */}
      <Modal
        open={!!createdRawToken}
        onClose={() => setCreatedRawToken(null)}
        title={"🔑 " + t("common.tokens.created")}
      >
        <div className="space-y-4">
          <p className="text-sm text-yellow-400">
            ⚠️ {t("common.tokens.copyWarning")}
          </p>
          <div className="bg-black/50 border border-[var(--color-dark-gray)] rounded-lg p-3 break-all font-mono text-sm text-[var(--color-primary-green)]">
            {createdRawToken}
          </div>
          <button
            onClick={() => handleCopy(createdRawToken ?? "")}
            className="w-full rounded-lg bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] px-4 py-2 font-semibold text-black transition-all hover:opacity-90"
          >
            {copied
              ? t("common.tokens.copied")
              : "📋 " + t("common.tokens.copy")}
          </button>
        </div>
      </Modal>

      {/* Delete confirmation */}
      <Modal
        open={!!deleteToken}
        onClose={() => setDeleteToken(null)}
        title={t("common.tokens.delete")}
      >
        <div className="text-center space-y-4">
          <p className="text-white">{t("common.tokens.deleteConfirm")}</p>
          <p className="text-sm text-[var(--color-light-text)]">
            {deleteToken?.name}
          </p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => setDeleteToken(null)}
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
