"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/src/hooks/useLocale";
import { useAuth } from "@/src/hooks/useAuth";
import GenericList from "@/src/components/shared/GenericList";
import Modal from "@/src/components/shared/Modal";
import Spinner from "@/src/components/shared/Spinner";
import ErrorDisplay from "@/src/components/shared/ErrorDisplay";
import EditButton from "@/src/components/shared/EditButton";
import DeleteButton from "@/src/components/shared/DeleteButton";
import MultiBadgeField from "@/src/components/fields/MultiBadgeField";
import TranslatedBadge from "@/src/components/shared/TranslatedBadge";
import SearchableSelectField from "@/src/components/fields/SearchableSelectField";
import type { CursorParams, PaginatedResult } from "@/src/contracts/common";

interface RoleItem {
  id: string;
  name: string;
  systemId: string;
  permissions: string[];
  isBuiltIn: boolean;
  createdAt: string;
  [key: string]: unknown;
}

interface SystemOption {
  id: string;
  slug: string;
  name: string;
}

export default function RolesPage() {
  const { t } = useLocale();
  const { systemToken } = useAuth();
  const [systems, setSystems] = useState<SystemOption[]>([]);
  const [loadingSystems, setLoadingSystems] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editItem, setEditItem] = useState<RoleItem | null>(null);
  const [formName, setFormName] = useState("");
  const [formSystemId, setFormSystemId] = useState("");
  const [formPermissions, setFormPermissions] = useState<string[]>([]);
  const [formIsBuiltIn, setFormIsBuiltIn] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [formSystemSelected, setFormSystemSelected] = useState<
    { id: string; label: string }[]
  >([]);
  const [reloadKey, setReloadKey] = useState(0);

  const loadSystems = async () => {
    setLoadingSystems(true);
    try {
      const res = await fetch("/api/core/systems?limit=200", {
        headers: { Authorization: `Bearer ${systemToken}` },
      });
      const json = await res.json();
      if (json.success) setSystems(json.data ?? []);
    } catch {
      /* ignore */
    } finally {
      setLoadingSystems(false);
    }
  };

  const systemFetchFn = useCallback(
    async (search: string) => {
      const q = search.toLowerCase();
      return systems
        .filter((s) =>
          !q || s.name.toLowerCase().includes(q) ||
          s.slug.toLowerCase().includes(q)
        )
        .map((s) => ({ id: s.id, label: s.name }));
    },
    [systems],
  );

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
        data: (json.data ?? []) as RoleItem[],
        nextCursor: json.nextCursor ?? null,
        prevCursor: null,
      };
    },
    [systemToken],
  );

  const triggerReload = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    loadSystems();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openCreate = () => {
    setFormName("");
    const firstSys = systems[0];
    setFormSystemId(firstSys?.id ?? "");
    setFormSystemSelected(
      firstSys ? [{ id: firstSys.id, label: firstSys.name }] : [],
    );
    setFormPermissions([]);
    setFormIsBuiltIn(false);
    setError(null);
    setShowCreate(true);
  };

  const openEdit = (item: RoleItem) => {
    setFormName(item.name);
    setFormSystemId(item.systemId);
    const sys = systems.find((s) => s.id === item.systemId);
    setFormSystemSelected(
      sys ? [{ id: sys.id, label: sys.name }] : [],
    );
    setFormPermissions([...item.permissions]);
    setFormIsBuiltIn(item.isBuiltIn);
    setError(null);
    setEditItem(item);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setValidationErrors([]);
    try {
      const payload = {
        id: editItem?.id,
        name: formName,
        systemId: formSystemId,
        permissions: formPermissions,
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
                {role.permissions.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {role.permissions.map((perm) => (
                      <TranslatedBadge
                        key={perm}
                        kind="permission"
                        token={perm}
                        systemSlug={sysSlug}
                      />
                    ))}
                  </div>
                )}
              </div>
              <div className="flex gap-2 ml-3 shrink-0">
                <EditButton onClick={() => openEdit(role)} />
                <DeleteButton onConfirm={() => handleDelete(role.id)} />
              </div>
            </div>
          );
        }}
      />

      {/* Create/Edit Modal */}
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
          <div>
            <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
              {t("core.roles.system")} *
            </label>
            <SearchableSelectField
              key={editItem?.id ?? "create"}
              fetchFn={systemFetchFn}
              showAllOnEmpty
              initialSelected={formSystemSelected}
              onChange={(items) => {
                setFormSystemId(items.length > 0 ? items[0].id : "");
              }}
              placeholder={t("core.roles.selectSystem")}
            />
          </div>
          <MultiBadgeField
            name={t("core.roles.permissions")}
            mode="custom"
            value={formPermissions}
            onChange={(vals) => setFormPermissions(vals as string[])}
            formatHint={t("core.roles.permissionsHint")}
            renderBadge={(item, remove) => (
              <TranslatedBadge
                kind="permission"
                token={typeof item === "string" ? item : item.name}
                systemSlug={getSystemSlug(formSystemId)}
                onRemove={remove}
              />
            )}
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
