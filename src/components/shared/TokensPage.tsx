"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import GenericList from "@/src/components/shared/GenericList";
import Modal from "@/src/components/shared/Modal";
import Spinner from "@/src/components/shared/Spinner";
import ErrorDisplay from "@/src/components/shared/ErrorDisplay";
import CreateButton from "@/src/components/shared/CreateButton";
import DeleteButton from "@/src/components/shared/DeleteButton";
import TenantView from "@/src/components/shared/TenantView";
import TenantSubform from "@/src/components/subforms/TenantSubform";
import ResourceLimitsSubform from "@/src/components/subforms/ResourceLimitsSubform";
import TokenView from "@/src/components/shared/TokenView";
import type { SubformRef } from "@/src/contracts/high-level/components";
import type {
  CursorParams,
  PaginatedResult,
} from "@/src/contracts/high-level/pagination";
import type { ApiTokenView } from "@/src/contracts/high-level/tokens";
import DateSubForm from "@/src/components/subforms/DateSubForm";
import { useTenantContext } from "@/src/hooks/useTenantContext";

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
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [createdRawToken, setCreatedRawToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newActorType, setNewActorType] = useState<"app" | "token">("token");
  const [newNeverExpires, setNewNeverExpires] = useState(true);

  const limitsRef = useRef<SubformRef>(null);
  const tenantRef = useRef<SubformRef>(null);
  const expiryRef = useRef<SubformRef>(null);

  const fetchTokens = useCallback(
    async (
      params: CursorParams & { search?: string },
    ): Promise<PaginatedResult<ApiTokenView>> => {
      if (!systemToken || !companyId) {
        return { items: [], total: 0, hasMore: false };
      }
      const p = new URLSearchParams({ companyId });
      if (systemId) p.set("systemId", systemId);
      if (params.cursor) p.set("cursor", params.cursor);
      p.set("limit", String(params.limit));
      const res = await fetch(`/api/tokens?${p}`, {
        headers: { Authorization: `Bearer ${systemToken}` },
      });
      const json = await res.json();
      return {
        items: (json.items ?? []) as ApiTokenView[],
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
    setNewNeverExpires(true);
    setError(null);
  };

  const handleCreate = async () => {
    if (!systemToken || !companyId || !systemId || !newName.trim()) {
      return;
    }
    setActionLoading(true);
    setError(null);
    try {
      const limitsData = limitsRef.current?.getData() ?? {};
      const tenantData = tenantRef.current?.getData() ?? {};
      const expiryData = expiryRef.current?.getData() ?? {};

      if (tenantData.roleIds) {
        limitsData.roleIds = tenantData.roleIds;
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
          neverExpires: newNeverExpires,
          expiresAt: newNeverExpires ? undefined : expiryData.date || undefined,
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
        <CreateButton
          onClick={() => {
            resetCreateForm();
            setCreateOpen(true);
          }}
          label={t("common.tokens.create")}
        />
      </div>

      <GenericList<ApiTokenView>
        entityName={t("common.menu.tokens")}
        searchEnabled={false}
        createEnabled={false}
        controlButtons={[]}
        fetchFn={fetchTokens}
        reloadKey={reloadKey}
        renderItem={(token) => (
          <TokenView
            token={token}
            systemSlug={systemSlug ?? undefined}
            controls={
              <DeleteButton
                onConfirm={async () => {
                  setError(null);
                  const res = await fetch("/api/tokens", {
                    method: "DELETE",
                    headers: {
                      "Content-Type": "application/json",
                      Authorization: `Bearer ${systemToken}`,
                    },
                    body: JSON.stringify({ id: token.id }),
                  });
                  const json = await res.json();
                  if (!json.success) {
                    setError(json.error?.message ?? "common.error.generic");
                    return;
                  }
                  triggerReload();
                }}
              />
            }
          />
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
            visibleFields={["roleIds"]}
            initialGranular={true}
          />

          <ResourceLimitsSubform
            ref={limitsRef}
            valueMode="absolute"
            systemSlug={systemSlug ?? undefined}
            initialGranular={true}
          />
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="token-never-expires"
              checked={newNeverExpires}
              onChange={(e) => setNewNeverExpires(e.target.checked)}
              className="rounded border-[var(--color-dark-gray)] bg-white/5"
            />
            <label
              htmlFor="token-never-expires"
              className="text-sm text-[var(--color-light-text)] cursor-pointer"
            >
              {t("common.tokens.neverExpires")}
            </label>
          </div>
          {!newNeverExpires && (
            <DateSubForm
              ref={expiryRef}
              mode="date"
              label={t("common.expires")}
            />
          )}
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
    </div>
  );
}
