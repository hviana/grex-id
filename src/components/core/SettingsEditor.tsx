"use client";

import { useCallback, useEffect, useState } from "react";
import Spinner from "@/src/components/shared/Spinner";
import ErrorDisplay from "@/src/components/shared/ErrorDisplay";
import SearchField from "@/src/components/shared/SearchField";
import SearchableSelectField from "@/src/components/fields/SearchableSelectField";
import { useDebounce } from "@/src/hooks/useDebounce";
import { useTenantContext } from "@/src/hooks/useTenantContext";
import type { SettingItem } from "@/src/contracts/high-level/settings";
import type { SettingsEditorProps } from "@/src/contracts/high-level/component-props";

export default function SettingsEditor(
  { mode = "core" }: SettingsEditorProps,
) {
  const { t } = useTenantContext();
  const { systemToken } = useTenantContext();
  const isFront = mode === "front";
  const apiPath = isFront ? "/api/core/front-settings" : "/api/core/settings";
  const titleKey = isFront ? "core.frontSettings.title" : "core.settings.title";

  const [settings, setSettings] = useState<SettingItem[]>([]);
  const [selectedSystem, setSelectedSystem] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 200);

  const [edits, setEdits] = useState<
    Map<string, { value: string; description: string }>
  >(new Map());

  const load = async () => {
    setLoading(true);
    try {
      const params = selectedSystem
        ? `?systemSlug=${encodeURIComponent(selectedSystem)}`
        : "";
      const res = await fetch(`${apiPath}${params}`, {
        headers: { Authorization: `Bearer ${systemToken}` },
      });
      const json = await res.json();
      if (json.success) setSettings(json.data?.settings ?? json.data ?? []);
    } finally {
      setLoading(false);
    }
  };

  const systemFetchFn = useCallback(
    async (search: string) => {
      const res = await fetch(
        `/api/core/systems?search=${encodeURIComponent(search)}&limit=50`,
        { headers: { Authorization: `Bearer ${systemToken}` } },
      );
      const json = await res.json();
      return (json.data ?? []).map((s: Record<string, unknown>) => ({
        id: String(s.slug ?? ""),
        label: String(s.name ?? ""),
      }));
    },
    [systemToken],
  );

  useEffect(() => {
    load();
  }, [apiPath, selectedSystem]);

  const getEdit = (setting: SettingItem) => {
    return edits.get(setting.key) ??
      { value: setting.value, description: setting.description };
  };

  const updateEdit = (
    key: string,
    field: "value" | "description",
    val: string,
  ) => {
    setEdits((prev) => {
      const next = new Map(prev);
      const existing = next.get(key) ??
        {
          value: settings.find((s) => s.key === key)?.value ?? "",
          description: settings.find((s) => s.key === key)?.description ?? "",
        };
      next.set(key, { ...existing, [field]: val });
      return next;
    });
  };

  const saveSetting = async (setting: SettingItem) => {
    const edit = getEdit(setting);
    setSavingKey(setting.key);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        settings: [{
          key: setting.key,
          value: edit.value,
          description: edit.description,
        }],
      };
      if (selectedSystem) body.systemSlug = selectedSystem;
      const res = await fetch(apiPath, {
        method: "PUT",
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
      edits.delete(setting.key);
      setEdits(new Map(edits));
      load();
    } finally {
      setSavingKey(null);
    }
  };

  const deleteSetting = async (key: string) => {
    setError(null);
    setDeletingKey(key);
    try {
      const body: Record<string, unknown> = { key };
      if (selectedSystem) body.systemSlug = selectedSystem;
      await fetch(apiPath, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${systemToken}`,
        },
        body: JSON.stringify(body),
      });
      load();
    } finally {
      setDeletingKey(null);
    }
  };

  const addSetting = () => {
    const newSetting: SettingItem = {
      id: `new-${Date.now()}`,
      key: "",
      value: "",
      description: "",
      updatedAt: new Date().toISOString(),
    };
    setSettings((prev) => [newSetting, ...prev]);
    setEdits((prev) => {
      const next = new Map(prev);
      next.set(newSetting.key, { value: "", description: "" });
      return next;
    });
  };

  const filtered = settings.filter((s) => {
    if (!debouncedSearch) return true;
    const q = debouncedSearch.toLowerCase();
    const edit = getEdit(s);
    return s.key.toLowerCase().includes(q) ||
      edit.value.toLowerCase().includes(q) ||
      edit.description.toLowerCase().includes(q);
  });

  const inputCls =
    "w-full rounded border border-[var(--color-dark-gray)] bg-white/5 px-3 py-1.5 text-sm text-white outline-none focus:border-[var(--color-primary-green)] transition-colors placeholder-white/30";

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 mb-2">
        <h2 className="text-xl font-bold text-white">
          {t(titleKey)}
        </h2>
        <span className="text-xs px-2 py-1 rounded-full bg-white/10 text-[var(--color-light-text)]">
          {isFront ? "front_setting" : "setting"}
          {selectedSystem ? ` (${selectedSystem})` : ""}
        </span>
      </div>

      <ErrorDisplay message={error} />

      <div className="flex flex-wrap items-center gap-3">
        <div className="w-64">
          <SearchableSelectField
            fetchFn={systemFetchFn}
            showAllOnEmpty
            onChange={(items) => {
              setSelectedSystem(items.length > 0 ? items[0].id : "");
              setEdits(new Map());
            }}
            placeholder={t("core.settings.scope.core")}
          />
        </div>

        <div className="flex-1 min-w-48">
          <SearchField onSearch={setSearch} />
        </div>
        <button
          onClick={addSetting}
          className="rounded-lg bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] px-4 py-2 text-sm font-semibold text-black transition-all hover:opacity-90"
        >
          ➕ {t("core.settings.add")}
        </button>
      </div>

      {filtered.length === 0
        ? (
          <p className="text-center py-8 text-[var(--color-light-text)]">
            {t("core.settings.empty")}
          </p>
        )
        : (
          <div className="space-y-3">
            {filtered.map((setting) => {
              const edit = getEdit(setting);
              const isDirty = edit.value !== setting.value ||
                edit.description !== setting.description;
              return (
                <div
                  key={setting.id}
                  className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-4 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-mono text-[var(--color-secondary-blue)] font-medium">
                      {setting.key || "(new)"}
                    </span>
                    <div className="flex items-center gap-2">
                      {isDirty && (
                        <button
                          onClick={() => saveSetting(setting)}
                          disabled={savingKey === setting.key}
                          className="text-xs rounded bg-[var(--color-primary-green)]/20 text-[var(--color-primary-green)] px-3 py-1 hover:bg-[var(--color-primary-green)]/30 transition-colors disabled:opacity-50 flex items-center gap-1"
                        >
                          {savingKey === setting.key
                            ? <Spinner size="sm" />
                            : null}
                          💾 {t("common.save")}
                        </button>
                      )}
                      <button
                        onClick={() => deleteSetting(setting.key)}
                        disabled={deletingKey === setting.key}
                        className="text-xs text-red-400 hover:text-red-300 px-2 py-1 transition-colors disabled:opacity-50"
                      >
                        {deletingKey === setting.key
                          ? <Spinner size="sm" />
                          : "🗑️"}
                      </button>
                    </div>
                  </div>
                  {setting.id.startsWith("new-") && (
                    <input
                      type="text"
                      value={setting.key}
                      onChange={(e) => {
                        const newKey = e.target.value;
                        setSettings((prev) =>
                          prev.map((s) =>
                            s.id === setting.id ? { ...s, key: newKey } : s
                          )
                        );
                      }}
                      placeholder={t("core.settings.placeholder.key")}
                      className={inputCls}
                    />
                  )}
                  <input
                    type="text"
                    value={edit.value}
                    onChange={(e) =>
                      updateEdit(setting.key, "value", e.target.value)}
                    placeholder={t("core.settings.value")}
                    className={inputCls}
                  />
                  <input
                    type="text"
                    value={edit.description}
                    onChange={(e) =>
                      updateEdit(setting.key, "description", e.target.value)}
                    placeholder={t("core.settings.descriptionPlaceholder")}
                    className={`${inputCls} text-[var(--color-light-text)]`}
                  />
                </div>
              );
            })}
          </div>
        )}
    </div>
  );
}
