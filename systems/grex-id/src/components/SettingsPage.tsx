"use client";

import { useCallback, useEffect, useState } from "react";
import Spinner from "@/src/components/shared/Spinner";
import { useTenantContext } from "@/src/hooks/useTenantContext";

export default function SettingsPage() {
  const { t, systemToken } = useTenantContext();
  const { tenant } = useTenantContext();
  const [sensitivity, setSensitivity] = useState(0.5);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!tenant?.companyId || !tenant?.systemId || !systemToken) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const res = await fetch("/api/tenant-data", {
          headers: { Authorization: `Bearer ${systemToken}` },
        });
        const json = await res.json();
        if (!cancelled && json.success && json.data?.data) {
          const val = Number(json.data.data["detection.sensitivity"] ?? 0.5);
          if (!isNaN(val)) setSensitivity(val);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [tenant?.companyId, tenant?.systemId, systemToken]);

  const handleSave = useCallback(async () => {
    if (!systemToken) return;
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/tenant-data", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${systemToken}`,
        },
        body: JSON.stringify({
          data: { "detection.sensitivity": sensitivity },
        }),
      });
      const json = await res.json();
      if (json.success) setSaved(true);
    } finally {
      setSaving(false);
    }
  }, [sensitivity, systemToken]);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <span className="text-2xl">⚙</span>
        <h1 className="text-2xl font-bold bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent">
          {t("systems.grex-id.settings.title")}
        </h1>
      </div>

      <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-6 space-y-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-[var(--color-light-text)]">
              🎯 {t("systems.grex-id.settings.sensitivity")}
            </label>
            <span className="text-sm font-mono text-white bg-white/5 border border-[var(--color-dark-gray)] rounded px-3 py-1">
              {sensitivity.toFixed(2)}
            </span>
          </div>

          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={sensitivity}
            onChange={(e) => setSensitivity(parseFloat(e.target.value))}
            className="w-full h-2 rounded-lg appearance-none cursor-pointer bg-[var(--color-dark-gray)] accent-[var(--color-primary-green)]"
          />

          <div className="flex justify-between text-xs text-[var(--color-light-text)]">
            <span>{t("systems.grex-id.settings.low")}</span>
            <span>{t("systems.grex-id.settings.high")}</span>
          </div>

          <p className="text-xs text-[var(--color-light-text)] leading-relaxed">
            {t("systems.grex-id.settings.sensitivityHelp")}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-hover-green)] px-6 py-2.5 text-sm font-semibold text-black transition-all hover:opacity-90 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-[var(--color-light-green)]/20 disabled:opacity-50 flex items-center gap-2"
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
          {saved && (
            <span className="text-sm text-[var(--color-primary-green)]">
              ✓ {t("common.saved")}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
