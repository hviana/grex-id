"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/src/hooks/useLocale";
import Spinner from "@/src/components/shared/Spinner";
import ErrorDisplay from "@/src/components/shared/ErrorDisplay";

interface SettingRow {
  id?: string;
  key: string;
  value: string;
  description: string;
}

interface MissingSetting {
  key: string;
  firstRequestedAt: string;
}

export default function SettingsPage() {
  const { t } = useLocale();
  const [settings, setSettings] = useState<SettingRow[]>([]);
  const [missingSettings, setMissingSettings] = useState<MissingSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [settingsRes, missingRes] = await Promise.all([
        fetch("/api/core/settings"),
        fetch("/api/core/settings/missing"),
      ]);
      const settingsJson = await settingsRes.json();
      const missingJson = await missingRes.json();
      if (settingsJson.success) {
        setSettings(
          (settingsJson.data ?? []).map((s: Record<string, unknown>) => ({
            id: s.id as string,
            key: (s.key as string) ?? "",
            value: (s.value as string) ?? "",
            description: (s.description as string) ?? "",
          })),
        );
      }
      if (missingJson.success) {
        setMissingSettings(missingJson.data ?? []);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const addRow = () => {
    setSettings((prev) => [
      ...prev,
      { key: "", value: "", description: "" },
    ]);
  };

  const removeRow = (index: number) => {
    setSettings((prev) => prev.filter((_, i) => i !== index));
  };

  const updateRow = (index: number, field: keyof SettingRow, val: string) => {
    setSettings((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [field]: val } : row))
    );
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const filtered = settings.filter((s) => s.key.trim() !== "");
      const res = await fetch("/api/core/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: filtered }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error?.message ?? "common.error.generic");
        return;
      }
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
      load();
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    "w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-[var(--color-primary-green)] transition-colors";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent">
          {t("core.settings.title")}
        </h1>
        <button
          onClick={addRow}
          className="rounded-lg bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] px-4 py-2 text-sm font-semibold text-black transition-all hover:opacity-90 flex items-center gap-1"
        >
          <span>➕</span>
          {t("core.settings.addRow")}
        </button>
      </div>

      <ErrorDisplay message={error} />

      {success && (
        <div className="rounded-lg border border-[var(--color-primary-green)]/30 bg-[var(--color-primary-green)]/10 px-4 py-3 text-sm text-[var(--color-primary-green)]">
          {t("core.settings.saved")}
        </div>
      )}

      {missingSettings.length > 0 && (
        <div className="rounded-xl border border-dashed border-yellow-500/40 bg-yellow-500/5 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-yellow-400">
              {t("core.settings.missingTitle", {
                count: String(missingSettings.length),
              })}
            </p>
            <button
              onClick={() => {
                const existingKeys = new Set(settings.map((s) => s.key));
                const newRows = missingSettings
                  .filter((m) => !existingKeys.has(m.key))
                  .map((m) => ({
                    key: m.key,
                    value: "",
                    description: "",
                  }));
                if (newRows.length > 0) {
                  setSettings((prev) => [...prev, ...newRows]);
                }
              }}
              className="rounded-lg border border-yellow-500/40 px-3 py-1.5 text-xs text-yellow-400 hover:bg-yellow-500/10 transition-colors"
            >
              {t("core.settings.addMissing")}
            </button>
          </div>
          <div className="space-y-1">
            {missingSettings.map((m) => (
              <div
                key={m.key}
                className="flex items-center gap-3 text-xs text-[var(--color-light-text)]"
              >
                <code className="font-mono text-yellow-400/80">{m.key}</code>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading
        ? (
          <div className="flex justify-center py-12">
            <Spinner size="lg" />
          </div>
        )
        : settings.length === 0
        ? (
          <div className="text-center py-12">
            <p className="text-[var(--color-light-text)] mb-4">
              {t("core.settings.empty")}
            </p>
            <button
              onClick={addRow}
              className="rounded-lg border border-dashed border-[var(--color-dark-gray)] px-6 py-3 text-sm text-[var(--color-light-text)] hover:border-[var(--color-primary-green)] hover:text-[var(--color-primary-green)] transition-colors"
            >
              ➕ {t("core.settings.addFirst")}
            </button>
          </div>
        )
        : (
          <div className="space-y-3">
            {/* Header */}
            <div className="hidden sm:grid sm:grid-cols-12 gap-3 px-4 text-xs font-medium uppercase tracking-wider text-[var(--color-light-text)]">
              <div className="col-span-3">{t("core.settings.key")}</div>
              <div className="col-span-4">{t("core.settings.value")}</div>
              <div className="col-span-4">{t("core.settings.description")}</div>
              <div className="col-span-1" />
            </div>

            {settings.map((row, index) => (
              <div
                key={row.id ?? `new-${index}`}
                className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-4 hover:shadow-lg hover:shadow-[var(--color-light-green)]/10 transition-all"
              >
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-start">
                  <div className="sm:col-span-3">
                    <label className="block text-xs font-medium text-[var(--color-light-text)] mb-1 sm:hidden">
                      {t("core.settings.key")}
                    </label>
                    <input
                      type="text"
                      value={row.key}
                      onChange={(e) => updateRow(index, "key", e.target.value)}
                      placeholder="SETTING_KEY"
                      className={`${inputCls} font-mono`}
                    />
                  </div>
                  <div className="sm:col-span-4">
                    <label className="block text-xs font-medium text-[var(--color-light-text)] mb-1 sm:hidden">
                      {t("core.settings.value")}
                    </label>
                    <input
                      type="text"
                      value={row.value}
                      onChange={(e) =>
                        updateRow(index, "value", e.target.value)}
                      placeholder="value"
                      className={inputCls}
                    />
                  </div>
                  <div className="sm:col-span-4">
                    <label className="block text-xs font-medium text-[var(--color-light-text)] mb-1 sm:hidden">
                      {t("core.settings.description")}
                    </label>
                    <input
                      type="text"
                      value={row.description}
                      onChange={(e) =>
                        updateRow(index, "description", e.target.value)}
                      placeholder={t("core.settings.descriptionPlaceholder")}
                      className={inputCls}
                    />
                  </div>
                  <div className="sm:col-span-1 flex justify-end">
                    <button
                      onClick={() => removeRow(index)}
                      className="rounded-lg border border-[var(--color-dark-gray)] px-3 py-1.5 text-sm text-red-400 hover:border-red-400 transition-colors"
                      title={t("common.delete")}
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

      {settings.length > 0 && (
        <div className="flex justify-end pt-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] px-8 py-3 font-semibold text-black transition-all hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving
              ? (
                <Spinner
                  size="sm"
                  className="border-black border-t-transparent"
                />
              )
              : null}
            {t("core.settings.saveAll")}
          </button>
        </div>
      )}
    </div>
  );
}
