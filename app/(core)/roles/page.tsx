"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import GenericList from "@/src/components/shared/GenericList";
import Modal from "@/src/components/shared/Modal";
import Spinner from "@/src/components/shared/Spinner";
import ErrorDisplay from "@/src/components/shared/ErrorDisplay";
import EditButton from "@/src/components/shared/EditButton";
import DeleteButton from "@/src/components/shared/DeleteButton";
import TranslatedBadge from "@/src/components/shared/TranslatedBadge";
import TenantSubform from "@/src/components/subforms/TenantSubform";
import type { SubformRef } from "@/src/contracts/high_level/components";
import type {
  CursorParams,
  PaginatedResult,
} from "@/src/contracts/high_level/pagination";
import type { SystemOption } from "@/src/contracts/high_level/components";
import { useTenantContext } from "@/src/hooks/useTenantContext";

interface RoleItem {
  id: string;
  name: string;
  systemId: string;
  isBuiltIn: boolean;
  createdAt: string;
  [key: string]: unknown;
}

export default function RolesPage() {
  const { t } = useTenantContext();
  const { systemToken } = useTenantContext();
  const [systems, setSystems] = useState<SystemOption[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [editItem, setEditItem] = useState<RoleItem | null>(null);
  const [formName, setFormName] = useState("");
  const [formIsBuiltIn, setFormIsBuiltIn] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [reloadKey, setReloadKey] = useState(0);

  const tenantRef = useRef<SubformRef>(null);
  const [tenantInitial, setTenantInitial] = useState<
    Record<string, unknown> | undefined
  >(undefined);

  useEffect(() => {
    if (!systemToken) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/core/systems?limit=200", {
          headers: { Authorization: `Bearer ${systemToken}` },
        });
        const json = await res.json();
        if (json.success && !cancelled) setSystems(json.items ?? []);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [systemToken]);

  const fetchRoles = useCallback(
    async (
      params: CursorParams & { search?: string },
    ): Promise<PaginatedResult<RoleItem>> => {
      const p = new URLSearchParams();
      if (params.search) p.set("search", params.search);
      if (params.cursor) p.set("cursor", params.cursor);
      p.set("limit", String(params.limit));
      const res = await fetch(`/api/core/roles?${p}`, {
        headers: { Authorization: `Bearer ${systemToken}` },
      });
      const json = await res.json();
      return {
        items: (json.items ?? []) as RoleItem[],
        total: json.total ?? 0,
        hasMore: json.hasMore ?? false,
        nextCursor: json.nextCursor,
      };
    },
    [systemToken],
  );

  const triggerReload = () => setReloadKey((k) => k + 1);

  const openCreate = () => {
    setFormName("");
    setFormIsBuiltIn(false);
    setTenantInitial(undefined);
    setError(null);
    setShowCreate(true);
  };

  const openEdit = (item: RoleItem) => {
    setFormName(item.name);
    setFormIsBuiltIn(item.isBuiltIn);
    setTenantInitial({
      systemId: item.systemId,
      systemSlug: systems.find((s) => s.id === item.systemId)?.slug ?? "",
    });
    setError(null);
    setEditItem(item);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setValidationErrors([]);
    try {
      const tenantData = tenantRef.current?.getData() ?? {};
      const payload = {
        id: editItem?.id,
        name: formName,
        systemId: tenantData.systemId ?? "",
        isBuiltIn: formIsBuiltIn,
      };

      const method = editItem ? "PUT" : "POST";
      const res = await fetch("/api/core/roles", {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${systemToken}`,
        },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.success) {
        if (json.error?.errors) {
          setValidationErrors(json.error.errors);
        } else {
          setError(json.error?.message ?? "common.error.generic");
        }
        return;
      }
      setShowCreate(false);
      setEditItem(null);
      triggerReload();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    await fetch("/api/core/roles", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${systemToken}`,
      },
      body: JSON.stringify({ id }),
    });
    triggerReload();
  };

  const getSystemName = (sysId: string) => {
    const sys = systems.find((s) => s.id === sysId);
    return sys?.name ?? sysId;
  };

  const getSystemSlug = (sysId: string): string | undefined => {
    const sys = systems.find((s) => s.id === sysId);
    return sys?.slug;
  };

  const inputCls =
    "w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-2.5 text-white outline-none focus:border-[var(--color-primary-green)] transition-colors";

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent">
        {t("core.roles.title")}
      </h1>

      <GenericList<RoleItem>
        entityName={t("core.roles.create")}
        searchEnabled
        createEnabled
        controlButtons={[]}
        onCreateClick={openCreate}
        fetchFn={fetchRoles}
        reloadKey={reloadKey}
        renderItem={(role) => {
          const sysSlug = getSystemSlug(role.systemId);
          return (
            <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-4 flex items-center justify-between hover:-translate-y-0.5 hover:shadow-lg hover:shadow-[var(--color-light-green)]/10 transition-all">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3">
                  <span className="text-xl">🛡️</span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <TranslatedBadge
                        kind="role"
                        token={role.name}
                        systemSlug={sysSlug}
                      />
                      {role.isBuiltIn && (
                        <span className="shrink-0 rounded-full bg-[var(--color-secondary-blue)]/20 px-2 py-0.5 text-xs text-[var(--color-secondary-blue)]">
                          {t("core.roles.builtIn")}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-[var(--color-light-text)]">
                      {getSystemName(role.systemId)}
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex gap-2 ml-3 shrink-0">
                <EditButton onClick={() => openEdit(role)} />
                <DeleteButton onConfirm={() => handleDelete(role.id)} />
              </div>
            </div>
          );
        }}
      />

      <Modal
        open={showCreate || !!editItem}
        onClose={() => {
          setShowCreate(false);
          setEditItem(null);
        }}
        title={editItem ? t("core.roles.edit") : t("core.roles.create")}
      >
        <ErrorDisplay message={error} errors={validationErrors} />
        <form onSubmit={handleSave} className="mt-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
              {t("core.roles.name")} *
            </label>
            <input
              type="text"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              required
              placeholder="roles.admin.name"
              className={inputCls}
            />
          </div>

          <TenantSubform
            ref={tenantRef}
            key={editItem?.id ?? "create"}
            visibleFields={["systemId"]}
            requiredFields={["systemId"]}
            initialData={tenantInitial}
          />

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="isBuiltIn"
              checked={formIsBuiltIn}
              onChange={(e) => setFormIsBuiltIn(e.target.checked)}
              className="h-4 w-4 rounded border-[var(--color-dark-gray)] accent-[var(--color-primary-green)]"
            />
            <label
              htmlFor="isBuiltIn"
              className="text-sm text-[var(--color-light-text)]"
            >
              {t("core.roles.isBuiltIn")}
            </label>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-lg bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] px-4 py-3 font-semibold text-black transition-all hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving
              ? (
                <Spinner
                  size="sm"
                  className="border-black border-t-transparent"
                />
              )
              : null}
            {t("common.save")}
          </button>
        </form>
      </Modal>
    </div>
  );
}
