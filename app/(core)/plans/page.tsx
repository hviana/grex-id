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
import PlanCard from "@/src/components/shared/PlanCard";
import TranslatedBadge from "@/src/components/shared/TranslatedBadge";
import SearchableSelectField from "@/src/components/fields/SearchableSelectField";

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
  slug: string;
  name: string;
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
  const [formSystemSelected, setFormSystemSelected] = useState<
    { id: string; label: string }[]
  >([]);

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
    const firstSys = systems[0];
    setFormSystemId(firstSys?.id ?? "");
    setFormSystemSelected(
      firstSys ? [{ id: firstSys.id, label: firstSys.name }] : [],
    );
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
    const sys = systems.find((s) => s.id === item.systemId);
    setFormSystemSelected(
      sys ? [{ id: sys.id, label: sys.name }] : [],
    );
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
              <PlanCard
                key={plan.id}
                plan={plan}
                variant="core"
                systemSlug={systems.find((s) => s.id === plan.systemId)?.slug}
                badges={
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
                }
                actions={
                  <div className="mt-4 flex gap-2 justify-end">
                    <EditButton onClick={() => openEdit(plan)} />
                    <DeleteButton onConfirm={() => handleDelete(plan.id)} />
                  </div>
                }
                systemName={getSystemName(plan.systemId)}
              />
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
              <SearchableSelectField
                key={editItem?.id ?? "create"}
                fetchFn={systemFetchFn}
                showAllOnEmpty
                initialSelected={formSystemSelected}
                onChange={(items) => {
                  setFormSystemId(items.length > 0 ? items[0].id : "");
                }}
                placeholder={t("core.plans.selectSystem")}
              />
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
            renderBadge={(item, remove) => (
              <TranslatedBadge
                kind="permission"
                token={typeof item === "string" ? item : item.name}
                systemSlug={systems.find((s) => s.id === formSystemId)?.slug}
                onRemove={remove}
              />
            )}
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
