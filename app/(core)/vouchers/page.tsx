"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/src/hooks/useLocale";
import Spinner from "@/src/components/shared/Spinner";
import SearchField from "@/src/components/shared/SearchField";
import CreateButton from "@/src/components/shared/CreateButton";
import EditButton from "@/src/components/shared/EditButton";
import DeleteButton from "@/src/components/shared/DeleteButton";
import Modal from "@/src/components/shared/Modal";
import ErrorDisplay from "@/src/components/shared/ErrorDisplay";
import MultiBadgeField from "@/src/components/fields/MultiBadgeField";
import DynamicKeyValueField from "@/src/components/fields/DynamicKeyValueField";

interface VoucherItem {
  id: string;
  code: string;
  applicableCompanyIds: string[];
  priceModifier: number;
  permissions: string[];
  entityLimitModifiers: Record<string, number> | null;
  apiRateLimitModifier: number;
  storageLimitModifier: number;
  expiresAt: string | null;
  createdAt: string;
}

interface EntityLimitEntry {
  key: string;
  value: string;
  description: string;
}

function formatModifier(value: number): string {
  if (value > 0) return `- ${(value / 100).toFixed(2)}`;
  if (value < 0) return `+ ${(Math.abs(value) / 100).toFixed(2)}`;
  return "0";
}

function modifiersToKV(
  mods: Record<string, number> | null,
): EntityLimitEntry[] {
  if (!mods) return [];
  return Object.entries(mods).map(([key, val]) => ({
    key,
    value: String(val),
    description: "",
  }));
}

function kvToModifiers(kv: EntityLimitEntry[]): Record<string, number> | null {
  const filtered = kv.filter((e) => e.key.trim() && e.value.trim());
  if (filtered.length === 0) return null;
  const result: Record<string, number> = {};
  for (const entry of filtered) {
    result[entry.key.trim()] = Number(entry.value);
  }
  return result;
}

export default function VouchersPage() {
  const { t } = useLocale();
  const [vouchers, setVouchers] = useState<VoucherItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editItem, setEditItem] = useState<VoucherItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  // Form fields
  const [formCode, setFormCode] = useState("");
  const [formPriceModifier, setFormPriceModifier] = useState("0");
  const [formPermissions, setFormPermissions] = useState<string[]>([]);
  const [formEntityLimitModifiers, setFormEntityLimitModifiers] = useState<
    EntityLimitEntry[]
  >([]);
  const [formApiRateLimitModifier, setFormApiRateLimitModifier] = useState("0");
  const [formStorageLimitModifier, setFormStorageLimitModifier] = useState("0");
  const [formExpiresAt, setFormExpiresAt] = useState("");

  const load = useCallback(async (q?: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set("search", q);
      const res = await fetch(`/api/core/vouchers?${params}`);
      const json = await res.json();
      if (json.success) setVouchers(json.data ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleSearch = useCallback((q: string) => {
    setSearch(q);
    load(q);
  }, [load]);

  const openCreate = () => {
    setFormCode("");
    setFormPriceModifier("0");
    setFormPermissions([]);
    setFormEntityLimitModifiers([]);
    setFormApiRateLimitModifier("0");
    setFormStorageLimitModifier("0");
    setFormExpiresAt("");
    setError(null);
    setShowCreate(true);
  };

  const openEdit = (item: VoucherItem) => {
    setFormCode(item.code);
    setFormPriceModifier(String(item.priceModifier));
    setFormPermissions([...item.permissions]);
    setFormEntityLimitModifiers(modifiersToKV(item.entityLimitModifiers));
    setFormApiRateLimitModifier(String(item.apiRateLimitModifier));
    setFormStorageLimitModifier(String(item.storageLimitModifier / 1073741824));
    setFormExpiresAt(item.expiresAt ? item.expiresAt.slice(0, 16) : "");
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
        code: formCode,
        priceModifier: Number(formPriceModifier),
        permissions: formPermissions,
        entityLimitModifiers: kvToModifiers(formEntityLimitModifiers),
        apiRateLimitModifier: Number(formApiRateLimitModifier),
        storageLimitModifier: Math.round(
          Number(formStorageLimitModifier) * 1073741824,
        ),
        expiresAt: formExpiresAt ? new Date(formExpiresAt).toISOString() : null,
      };

      const method = editItem ? "PUT" : "POST";
      const res = await fetch("/api/core/vouchers", {
        method,
        headers: { "Content-Type": "application/json" },
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
    await fetch("/api/core/vouchers", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    load(search);
  };

  const isExpired = (expiresAt: string | null) => {
    if (!expiresAt) return false;
    return new Date(expiresAt) < new Date();
  };

  const inputCls =
    "w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-2.5 text-white outline-none focus:border-[var(--color-primary-green)] transition-colors";

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent">
        {t("core.vouchers.title")}
      </h1>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-48">
          <SearchField onSearch={handleSearch} />
        </div>
        <CreateButton
          onClick={openCreate}
          label={t("core.vouchers.create")}
        />
      </div>

      {loading
        ? (
          <div className="flex justify-center py-12">
            <Spinner size="lg" />
          </div>
        )
        : vouchers.length === 0
        ? (
          <p className="text-center py-12 text-[var(--color-light-text)]">
            {t("core.vouchers.empty")}
          </p>
        )
        : (
          <div className="space-y-3">
            {vouchers.map((voucher) => (
              <div
                key={voucher.id}
                className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-4 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-[var(--color-light-green)]/10 transition-all"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">🎟️</span>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-mono font-semibold text-white text-lg">
                          {voucher.code}
                        </h3>
                        {isExpired(voucher.expiresAt) && (
                          <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-xs text-red-400">
                            {t("core.vouchers.expired")}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-3 mt-1 text-sm text-[var(--color-light-text)]">
                        <span>
                          {t("core.vouchers.priceModifier")}:{" "}
                          <span
                            className={voucher.priceModifier > 0
                              ? "text-[var(--color-primary-green)]"
                              : voucher.priceModifier < 0
                              ? "text-red-400"
                              : "text-white"}
                          >
                            {formatModifier(voucher.priceModifier)}
                          </span>
                        </span>
                        {voucher.apiRateLimitModifier !== 0 && (
                          <span>
                            {t("core.vouchers.apiRate")}:{" "}
                            {voucher.apiRateLimitModifier > 0 ? "+" : ""}
                            {voucher.apiRateLimitModifier}
                          </span>
                        )}
                        {voucher.storageLimitModifier !== 0 && (
                          <span>
                            {t("core.vouchers.storage")}:{" "}
                            {voucher.storageLimitModifier > 0 ? "+" : ""}
                            {(voucher.storageLimitModifier / 1073741824)
                              .toFixed(1)} GB
                          </span>
                        )}
                        {voucher.expiresAt && !isExpired(voucher.expiresAt) && (
                          <span>
                            {t("core.vouchers.expires")}:{" "}
                            {new Date(voucher.expiresAt).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 ml-3 shrink-0">
                    <EditButton onClick={() => openEdit(voucher)} />
                    <DeleteButton onConfirm={() => handleDelete(voucher.id)} />
                  </div>
                </div>

                {voucher.permissions.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {voucher.permissions.map((perm) => (
                      <span
                        key={perm}
                        className="rounded-full bg-[var(--color-primary-green)]/15 px-2.5 py-0.5 text-xs text-[var(--color-primary-green)]"
                      >
                        {perm}
                      </span>
                    ))}
                  </div>
                )}

                {voucher.entityLimitModifiers &&
                  Object.keys(voucher.entityLimitModifiers).length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {Object.entries(voucher.entityLimitModifiers).map((
                      [key, val],
                    ) => (
                      <span
                        key={key}
                        className="rounded-full bg-[var(--color-secondary-blue)]/15 px-2.5 py-0.5 text-xs text-[var(--color-secondary-blue)]"
                      >
                        {key}: {val > 0 ? "+" : ""}
                        {val}
                      </span>
                    ))}
                  </div>
                )}
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
        title={editItem ? t("core.vouchers.edit") : t("core.vouchers.create")}
      >
        <ErrorDisplay message={error} errors={validationErrors} />
        <form onSubmit={handleSave} className="mt-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
              {t("core.vouchers.code")} *
            </label>
            <input
              type="text"
              value={formCode}
              onChange={(e) => setFormCode(e.target.value)}
              required
              placeholder="SUMMER2026"
              className={`${inputCls} font-mono`}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
                {t("core.vouchers.priceModifier")} ({t("core.vouchers.cents")})
              </label>
              <input
                type="number"
                value={formPriceModifier}
                onChange={(e) => setFormPriceModifier(e.target.value)}
                placeholder="500"
                className={inputCls}
              />
              <p className="mt-1 text-xs text-[var(--color-light-text)]/60">
                {t("core.vouchers.priceModifierHint")}
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
                {t("core.vouchers.expiresAt")}
              </label>
              <input
                type="datetime-local"
                value={formExpiresAt}
                onChange={(e) => setFormExpiresAt(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>

          <MultiBadgeField
            name={t("core.vouchers.permissions")}
            mode="custom"
            value={formPermissions}
            onChange={(vals) => setFormPermissions(vals as string[])}
          />

          <div>
            <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
              {t("core.vouchers.entityLimitModifiers")}
            </label>
            <p className="text-xs text-[var(--color-light-text)]/60 mb-2">
              {t("core.vouchers.entityLimitModifiersHint")}
            </p>
            <DynamicKeyValueField
              fields={formEntityLimitModifiers}
              onChange={setFormEntityLimitModifiers}
              showDescription={false}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
                {t("core.vouchers.apiRateLimitModifier")}
              </label>
              <input
                type="number"
                value={formApiRateLimitModifier}
                onChange={(e) => setFormApiRateLimitModifier(e.target.value)}
                placeholder="0"
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
                {t("core.vouchers.storageLimitModifier")} (GB)
              </label>
              <input
                type="number"
                value={formStorageLimitModifier}
                onChange={(e) => setFormStorageLimitModifier(e.target.value)}
                step="0.1"
                placeholder={t("core.plans.placeholder.storageGB")}
                className={`${inputCls} placeholder-white/30`}
              />
            </div>
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
