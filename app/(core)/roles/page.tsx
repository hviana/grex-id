"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/src/hooks/useLocale";
import { useAuth } from "@/src/hooks/useAuth";
import Spinner from "@/src/components/shared/Spinner";
import SearchField from "@/src/components/shared/SearchField";
import CreateButton from "@/src/components/shared/CreateButton";
import EditButton from "@/src/components/shared/EditButton";
import DeleteButton from "@/src/components/shared/DeleteButton";
import Modal from "@/src/components/shared/Modal";
import ErrorDisplay from "@/src/components/shared/ErrorDisplay";
import MultiBadgeField from "@/src/components/fields/MultiBadgeField";

interface RoleItem {
  id: string;
  name: string;
  systemId: string;
  permissions: string[];
  isBuiltIn: boolean;
  createdAt: string;
}

interface SystemOption {
  id: string;
  name: string;
}

export default function RolesPage() {
  const { t } = useLocale();
  const { systemToken } = useAuth();
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [systems, setSystems] = useState<SystemOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editItem, setEditItem] = useState<RoleItem | null>(null);
  const [formName, setFormName] = useState("");
  const [formSystemId, setFormSystemId] = useState("");
  const [formPermissions, setFormPermissions] = useState<string[]>([]);
  const [formIsBuiltIn, setFormIsBuiltIn] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [loadingSystems, setLoadingSystems] = useState(true);

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

  const load = useCallback(async (q?: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set("search", q);
      const res = await fetch(`/api/core/roles?${params}`, {
        headers: { Authorization: `Bearer ${systemToken}` },
      });
      const json = await res.json();
      if (json.success) setRoles(json.data ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    loadSystems();
  }, [load]);

  const handleSearch = useCallback((q: string) => {
    setSearch(q);
    load(q);
  }, [load]);

  const openCreate = () => {
    setFormName("");
    setFormSystemId(systems[0]?.id ?? "");
    setFormPermissions([]);
    setFormIsBuiltIn(false);
    setError(null);
    setShowCreate(true);
  };

  const openEdit = (item: RoleItem) => {
    setFormName(item.name);
    setFormSystemId(item.systemId);
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
      load(search);
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
    load(search);
  };

  const getSystemName = (sysId: string) => {
    const sys = systems.find((s) => s.id === sysId);
    return sys?.name ?? sysId;
  };

  const inputCls =
    "w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-2.5 text-white outline-none focus:border-[var(--color-primary-green)] transition-colors";

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent">
        {t("core.roles.title")}
      </h1>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-48">
          <SearchField onSearch={handleSearch} />
        </div>
        <CreateButton onClick={openCreate} label={t("core.roles.create")} />
      </div>

      {loading
        ? (
          <div className="flex justify-center py-12">
            <Spinner size="lg" />
          </div>
        )
        : roles.length === 0
        ? (
          <p className="text-center py-12 text-[var(--color-light-text)]">
            {t("core.roles.empty")}
          </p>
        )
        : (
          <div className="space-y-3">
            {roles.map((role) => (
              <div
                key={role.id}
                className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-4 flex items-center justify-between hover:-translate-y-0.5 hover:shadow-lg hover:shadow-[var(--color-light-green)]/10 transition-all"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">🛡️</span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-white truncate">
                          {role.name}
                        </h3>
                        {role.isBuiltIn && (
                          <span className="shrink-0 rounded-full bg-[var(--color-secondary-blue)]/20 px-2 py-0.5 text-xs text-[var(--color-secondary-blue)]">
                            {t("core.roles.builtIn")}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-[var(--color-light-text)]">
                        {getSystemName(role.systemId)}
                      </p>
                    </div>
                  </div>
                  {role.permissions.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {role.permissions.map((perm) => (
                        <span
                          key={perm}
                          className="rounded-full bg-[var(--color-primary-green)]/15 px-2.5 py-0.5 text-xs text-[var(--color-primary-green)]"
                        >
                          {perm}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex gap-2 ml-3 shrink-0">
                  <EditButton onClick={() => openEdit(role)} />
                  <DeleteButton onConfirm={() => handleDelete(role.id)} />
                </div>
              </div>
            ))}
          </div>
        )}

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
            <div className="relative">
              <select
                value={formSystemId}
                onChange={(e) => setFormSystemId(e.target.value)}
                required
                disabled={loadingSystems}
                className={inputCls}
              >
                <option value="" disabled>
                  {t("core.roles.selectSystem")}
                </option>
                {systems.map((sys) => (
                  <option key={sys.id} value={sys.id}>
                    {sys.name}
                  </option>
                ))}
              </select>
              {loadingSystems && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <Spinner size="sm" />
                </div>
              )}
            </div>
          </div>
          <MultiBadgeField
            name={t("core.roles.permissions")}
            mode="custom"
            value={formPermissions}
            onChange={(vals) => setFormPermissions(vals as string[])}
            formatHint={t("core.roles.permissionsHint")}
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
