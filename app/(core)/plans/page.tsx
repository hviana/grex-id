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
import DynamicKeyValueField from "@/src/components/fields/DynamicKeyValueField";

interface PlanItem {
  id: string;
  name: string;
  description: string;
  systemId: string;
  price: number;
  currency: string;
  recurrenceDays: number;
  benefits: string[];
  permissions: string[];
  entityLimits: Record<string, number> | null;
  apiRateLimit: number;
  storageLimitBytes: number;
  fileCacheLimitBytes: number;
  planCredits: number;
  maxConcurrentDownloads: number;
  maxConcurrentUploads: number;
  maxDownloadBandwidthMB: number;
  maxUploadBandwidthMB: number;
  maxOperationCount: Record<string, number> | null;
  isActive: boolean;
  createdAt: string;
}

interface SystemOption {
  id: string;
  name: string;
}

function formatStorage(bytes: number): string {
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(cents / 100);
}

interface EntityLimitEntry {
  key: string;
  value: string;
  description: string;
}

function entityLimitsToKV(
  limits: Record<string, number> | null,
): EntityLimitEntry[] {
  if (!limits) return [];
  return Object.entries(limits).map(([key, val]) => ({
    key,
    value: String(val),
    description: "",
  }));
}

function kvToEntityLimits(
  kv: EntityLimitEntry[],
): Record<string, number> | null {
  const filtered = kv.filter((e) => e.key.trim() && e.value.trim());
  if (filtered.length === 0) return null;
  const result: Record<string, number> = {};
  for (const entry of filtered) {
    result[entry.key.trim()] = Number(entry.value);
  }
  return result;
}

export default function PlansPage() {
  const { t } = useLocale();
  const { systemToken } = useAuth();
  const [plans, setPlans] = useState<PlanItem[]>([]);
  const [systems, setSystems] = useState<SystemOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editItem, setEditItem] = useState<PlanItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  // Form fields
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formSystemId, setFormSystemId] = useState("");
  const [formPrice, setFormPrice] = useState("");
  const [formCurrency, setFormCurrency] = useState("USD");
  const [formRecurrenceDays, setFormRecurrenceDays] = useState("30");
  const [formBenefits, setFormBenefits] = useState<string[]>([]);
  const [formPermissions, setFormPermissions] = useState<string[]>([]);
  const [formEntityLimits, setFormEntityLimits] = useState<EntityLimitEntry[]>(
    [],
  );
  const [formApiRateLimit, setFormApiRateLimit] = useState("1000");
  const [formStorageGB, setFormStorageGB] = useState("1");
  const [formFileCacheMB, setFormFileCacheMB] = useState("20");
  const [formPlanCredits, setFormPlanCredits] = useState("0");
  const [formMaxConcurrentDownloads, setFormMaxConcurrentDownloads] = useState(
    "0",
  );
  const [formMaxConcurrentUploads, setFormMaxConcurrentUploads] = useState("0");
  const [formMaxDownloadBandwidthMB, setFormMaxDownloadBandwidthMB] = useState(
    "0",
  );
  const [formMaxUploadBandwidthMB, setFormMaxUploadBandwidthMB] = useState("0");
  const [formMaxOperationCount, setFormMaxOperationCount] = useState<
    EntityLimitEntry[]
  >([]);
  const [formIsActive, setFormIsActive] = useState(true);
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
    if (!systemToken) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set("search", q);
      const res = await fetch(`/api/core/plans?${params}`, {
        headers: { Authorization: `Bearer ${systemToken}` },
      });
      const json = await res.json();
      if (json.success) setPlans(json.data ?? []);
    } finally {
      setLoading(false);
    }
  }, [systemToken]);

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
    setFormDescription("");
    setFormSystemId(systems[0]?.id ?? "");
    setFormPrice("");
    setFormCurrency("USD");
    setFormRecurrenceDays("30");
    setFormBenefits([]);
    setFormPermissions([]);
    setFormEntityLimits([]);
    setFormApiRateLimit("1000");
    setFormStorageGB("1");
    setFormFileCacheMB("20");
    setFormPlanCredits("0");
    setFormMaxConcurrentDownloads("0");
    setFormMaxConcurrentUploads("0");
    setFormMaxDownloadBandwidthMB("0");
    setFormMaxUploadBandwidthMB("0");
    setFormMaxOperationCount([]);
    setFormIsActive(true);
    setError(null);
    setShowCreate(true);
  };

  const openEdit = (item: PlanItem) => {
    setFormName(item.name ?? "");
    setFormDescription(item.description ?? "");
    setFormSystemId(String(item.systemId ?? ""));
    setFormPrice(String(item.price ?? 0));
    setFormCurrency(item.currency ?? "USD");
    setFormRecurrenceDays(String(item.recurrenceDays ?? 30));
    setFormBenefits(Array.isArray(item.benefits) ? [...item.benefits] : []);
    setFormPermissions(
      Array.isArray(item.permissions) ? [...item.permissions] : [],
    );
    setFormEntityLimits(entityLimitsToKV(item.entityLimits));
    setFormApiRateLimit(String(item.apiRateLimit ?? 1000));
    setFormStorageGB(
      String((item.storageLimitBytes ?? 1073741824) / 1073741824),
    );
    setFormFileCacheMB(
      String((item.fileCacheLimitBytes ?? 20971520) / 1048576),
    );
    setFormPlanCredits(String(item.planCredits ?? 0));
    setFormMaxConcurrentDownloads(String(item.maxConcurrentDownloads ?? 0));
    setFormMaxConcurrentUploads(String(item.maxConcurrentUploads ?? 0));
    setFormMaxDownloadBandwidthMB(String(item.maxDownloadBandwidthMB ?? 0));
    setFormMaxUploadBandwidthMB(String(item.maxUploadBandwidthMB ?? 0));
    setFormMaxOperationCount(entityLimitsToKV(item.maxOperationCount));
    setFormIsActive(item.isActive ?? true);
    setError(null);
    setValidationErrors([]);
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
        description: formDescription,
        systemId: formSystemId,
        price: Number(formPrice),
        currency: formCurrency,
        recurrenceDays: Number(formRecurrenceDays),
        benefits: formBenefits,
        permissions: formPermissions,
        entityLimits: kvToEntityLimits(formEntityLimits),
        apiRateLimit: Number(formApiRateLimit),
        storageLimitBytes: Math.round(Number(formStorageGB) * 1073741824),
        fileCacheLimitBytes: Math.round(Number(formFileCacheMB) * 1048576),
        planCredits: Number(formPlanCredits),
        maxConcurrentDownloads: Number(formMaxConcurrentDownloads),
        maxConcurrentUploads: Number(formMaxConcurrentUploads),
        maxDownloadBandwidthMB: Number(formMaxDownloadBandwidthMB),
        maxUploadBandwidthMB: Number(formMaxUploadBandwidthMB),
        maxOperationCount: kvToEntityLimits(formMaxOperationCount),
        isActive: formIsActive,
      };

      const method = editItem ? "PUT" : "POST";
      const res = await fetch("/api/core/plans", {
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
    await fetch("/api/core/plans", {
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
        {t("core.plans.title")}
      </h1>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-48">
          <SearchField onSearch={handleSearch} />
        </div>
        <CreateButton onClick={openCreate} label={t("core.plans.create")} />
      </div>

      {loading
        ? (
          <div className="flex justify-center py-12">
            <Spinner size="lg" />
          </div>
        )
        : plans.length === 0
        ? (
          <p className="text-center py-12 text-[var(--color-light-text)]">
            {t("core.plans.empty")}
          </p>
        )
        : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {plans.map((plan) => (
              <div
                key={plan.id}
                className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-5 flex flex-col hover:-translate-y-1 hover:shadow-lg hover:shadow-[var(--color-light-green)]/20 transition-all"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">📋</span>
                    <div>
                      <h3 className="font-semibold text-white">{plan.name}</h3>
                      <p className="text-xs text-[var(--color-light-text)]">
                        {getSystemName(plan.systemId)}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                      plan.isActive
                        ? "bg-[var(--color-primary-green)]/20 text-[var(--color-primary-green)]"
                        : "bg-red-500/20 text-red-400"
                    }`}
                  >
                    {plan.isActive
                      ? t("core.plans.active")
                      : t("core.plans.inactive")}
                  </span>
                </div>

                <div className="mb-3">
                  <span className="text-2xl font-bold bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent">
                    {formatPrice(plan.price, plan.currency)}
                  </span>
                  <span className="text-sm text-[var(--color-light-text)] ml-1">
                    / {plan.recurrenceDays} {t("core.plans.days")}
                  </span>
                </div>

                {plan.description && (
                  <p className="text-sm text-[var(--color-light-text)] mb-3">
                    {plan.description}
                  </p>
                )}

                {plan.benefits?.length > 0 && (
                  <div className="mb-3 space-y-1">
                    {plan.benefits.map((benefit, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-1.5 text-sm text-[var(--color-light-text)]"
                      >
                        <span className="text-[var(--color-primary-green)]">
                          ✓
                        </span>
                        {benefit}
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-auto pt-3 border-t border-[var(--color-dark-gray)]/50 space-y-1 text-xs text-[var(--color-light-text)]">
                  <div className="flex justify-between">
                    <span>{t("core.plans.apiRateLimit")}</span>
                    <span className="text-white">
                      {plan.apiRateLimit.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>{t("core.plans.storage")}</span>
                    <span className="text-white">
                      {formatStorage(plan.storageLimitBytes)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>🗂️ {t("core.plans.fileCache")}</span>
                    <span className="text-white">
                      {formatStorage(plan.fileCacheLimitBytes ?? 20971520)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>{t("core.plans.planCredits")}</span>
                    <span className="text-white">{plan.planCredits ?? 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>⬇️ {t("core.plans.maxConcurrentDownloads")}</span>
                    <span className="text-white">
                      {(plan.maxConcurrentDownloads ?? 0) ||
                        t("billing.limits.unlimited")}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>⬆️ {t("core.plans.maxConcurrentUploads")}</span>
                    <span className="text-white">
                      {(plan.maxConcurrentUploads ?? 0) ||
                        t("billing.limits.unlimited")}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>📶 {t("core.plans.maxDownloadBandwidthMB")}</span>
                    <span className="text-white">
                      {(plan.maxDownloadBandwidthMB ?? 0) ||
                        t("billing.limits.unlimited")}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>📶 {t("core.plans.maxUploadBandwidthMB")}</span>
                    <span className="text-white">
                      {(plan.maxUploadBandwidthMB ?? 0) ||
                        t("billing.limits.unlimited")}
                    </span>
                  </div>
                  {plan.maxOperationCount &&
                      Object.keys(plan.maxOperationCount).length > 0
                    ? Object.entries(plan.maxOperationCount).map((
                      [key, val],
                    ) => (
                      <div key={key} className="flex justify-between">
                        <span>
                          🔢 {t(`billing.limits.${key}`) !==
                              `billing.limits.${key}`
                            ? t(`billing.limits.${key}`)
                            : key}
                        </span>
                        <span className="text-white">
                          {val.toLocaleString()}
                        </span>
                      </div>
                    ))
                    : (
                      <div className="flex justify-between">
                        <span>🔢 {t("core.plans.maxOperationCount")}</span>
                        <span className="text-white">
                          {t("billing.limits.unlimited")}
                        </span>
                      </div>
                    )}
                </div>

                {plan.permissions?.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1">
                    {plan.permissions.map((perm) => (
                      <span
                        key={perm}
                        className="rounded-full bg-[var(--color-secondary-blue)]/15 px-2 py-0.5 text-xs text-[var(--color-secondary-blue)]"
                      >
                        {perm}
                      </span>
                    ))}
                  </div>
                )}

                <div className="mt-4 flex gap-2 justify-end">
                  <EditButton onClick={() => openEdit(plan)} />
                  <DeleteButton onConfirm={() => handleDelete(plan.id)} />
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
        title={editItem ? t("core.plans.edit") : t("core.plans.create")}
      >
        <ErrorDisplay message={error} errors={validationErrors} />
        <form onSubmit={handleSave} className="mt-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
                {t("core.plans.name")} *
              </label>
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                required
                placeholder={t("core.plans.placeholder.name")}
                className={`${inputCls} placeholder-white/30`}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
                {t("core.plans.system")} *
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
                    {t("core.plans.selectSystem")}
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
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
              {t("core.plans.description")}
            </label>
            <input
              type="text"
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
              placeholder={t("core.plans.placeholder.description")}
              className={`${inputCls} placeholder-white/30`}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
                {t("core.plans.price")} * ({t("core.plans.cents")})
              </label>
              <input
                type="number"
                value={formPrice}
                onChange={(e) => setFormPrice(e.target.value)}
                required
                min="0"
                placeholder={t("core.plans.placeholder.price")}
                className={`${inputCls} placeholder-white/30`}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
                {t("core.plans.currency")}
              </label>
              <input
                type="text"
                value={formCurrency}
                onChange={(e) => setFormCurrency(e.target.value)}
                maxLength={3}
                placeholder={t("core.plans.placeholder.currency")}
                className={`${inputCls} placeholder-white/30`}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
                {t("core.plans.recurrenceDays")} *
              </label>
              <input
                type="number"
                value={formRecurrenceDays}
                onChange={(e) => setFormRecurrenceDays(e.target.value)}
                required
                min="1"
                placeholder={t("core.plans.placeholder.recurrenceDays")}
                className={`${inputCls} placeholder-white/30`}
              />
            </div>
          </div>

          <MultiBadgeField
            name={t("core.plans.benefits")}
            mode="custom"
            value={formBenefits}
            onChange={(vals) => setFormBenefits(vals as string[])}
            formatHint={t("core.plans.benefitsHint")}
          />

          <MultiBadgeField
            name={t("core.plans.permissions")}
            mode="custom"
            value={formPermissions}
            onChange={(vals) => setFormPermissions(vals as string[])}
          />

          <div>
            <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
              {t("core.plans.entityLimits")}
            </label>
            <p className="text-xs text-[var(--color-light-text)]/60 mb-2">
              {t("core.plans.entityLimitsHint")}
            </p>
            <DynamicKeyValueField
              fields={formEntityLimits}
              onChange={setFormEntityLimits}
              showDescription={false}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
                {t("core.plans.apiRateLimit")}
              </label>
              <input
                type="number"
                value={formApiRateLimit}
                onChange={(e) => setFormApiRateLimit(e.target.value)}
                min="1"
                placeholder={t("core.plans.placeholder.apiRateLimit")}
                className={`${inputCls} placeholder-white/30`}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
                {t("core.plans.storageLimit")} (GB)
              </label>
              <input
                type="number"
                value={formStorageGB}
                onChange={(e) => setFormStorageGB(e.target.value)}
                min="0"
                step="0.1"
                placeholder={t("core.plans.placeholder.storageGB")}
                className={`${inputCls} placeholder-white/30`}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
                {t("core.plans.fileCacheLimit")} (MB)
              </label>
              <input
                type="number"
                value={formFileCacheMB}
                onChange={(e) => setFormFileCacheMB(e.target.value)}
                min="0"
                step="1"
                placeholder={t("core.plans.placeholder.fileCacheMB")}
                className={`${inputCls} placeholder-white/30`}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
                {t("core.plans.planCredits")}
              </label>
              <input
                type="number"
                value={formPlanCredits}
                onChange={(e) => setFormPlanCredits(e.target.value)}
                min="0"
                placeholder="0"
                className={`${inputCls} placeholder-white/30`}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
                ⬇️ {t("core.plans.maxConcurrentDownloads")}
              </label>
              <input
                type="number"
                value={formMaxConcurrentDownloads}
                onChange={(e) => setFormMaxConcurrentDownloads(e.target.value)}
                min="0"
                placeholder="0"
                className={`${inputCls} placeholder-white/30`}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
                ⬆️ {t("core.plans.maxConcurrentUploads")}
              </label>
              <input
                type="number"
                value={formMaxConcurrentUploads}
                onChange={(e) => setFormMaxConcurrentUploads(e.target.value)}
                min="0"
                placeholder="0"
                className={`${inputCls} placeholder-white/30`}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
                📶 {t("core.plans.maxDownloadBandwidthMB")}
              </label>
              <input
                type="number"
                value={formMaxDownloadBandwidthMB}
                onChange={(e) => setFormMaxDownloadBandwidthMB(e.target.value)}
                min="0"
                step="0.1"
                placeholder="0"
                className={`${inputCls} placeholder-white/30`}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
                📶 {t("core.plans.maxUploadBandwidthMB")}
              </label>
              <input
                type="number"
                value={formMaxUploadBandwidthMB}
                onChange={(e) => setFormMaxUploadBandwidthMB(e.target.value)}
                min="0"
                step="0.1"
                placeholder="0"
                className={`${inputCls} placeholder-white/30`}
              />
            </div>
            <div className="col-span-1 sm:col-span-3">
              <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
                🔢 {t("core.plans.maxOperationCount")}
              </label>
              <p className="text-xs text-[var(--color-light-text)]/60 mb-2">
                {t("core.plans.maxOperationCountHint")}
              </p>
              <DynamicKeyValueField
                fields={formMaxOperationCount}
                onChange={setFormMaxOperationCount}
                showDescription={false}
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="isActive"
              checked={formIsActive}
              onChange={(e) => setFormIsActive(e.target.checked)}
              className="h-4 w-4 rounded border-[var(--color-dark-gray)] accent-[var(--color-primary-green)]"
            />
            <label
              htmlFor="isActive"
              className="text-sm text-[var(--color-light-text)]"
            >
              {t("core.plans.isActive")}
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
