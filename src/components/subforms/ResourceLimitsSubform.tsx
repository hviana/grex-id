"use client";

import { forwardRef, useImperativeHandle, useState } from "react";
import { useLocale } from "@/src/hooks/useLocale";
import type { SubformRef } from "@/src/components/shared/GenericList";
import MultiBadgeField from "@/src/components/fields/MultiBadgeField";
import DynamicKeyValueField from "@/src/components/fields/DynamicKeyValueField";
import TranslatedBadge from "@/src/components/shared/TranslatedBadge";

interface EntityLimitEntry {
  key: string;
  value: string;
  description: string;
}

function mapToKV(map: Record<string, number> | null): EntityLimitEntry[] {
  if (!map) return [];
  return Object.entries(map).map(([key, val]) => ({
    key,
    value: String(val),
    description: "",
  }));
}

function kvToMap(kv: EntityLimitEntry[]): Record<string, number> | null {
  const filtered = kv.filter((e) => e.key.trim() && e.value.trim());
  if (filtered.length === 0) return null;
  const result: Record<string, number> = {};
  for (const entry of filtered) {
    result[entry.key.trim()] = Number(entry.value);
  }
  return result;
}

interface ResourceLimitsSubformProps {
  mode: "plan" | "voucher";
  initialData?: Record<string, unknown>;
  systemSlug?: string;
}

const inputCls =
  "w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-2.5 text-white placeholder-white/30 outline-none focus:border-[var(--color-primary-green)] transition-colors";

const ResourceLimitsSubform = forwardRef<
  SubformRef,
  ResourceLimitsSubformProps
>(({ mode, initialData, systemSlug }, ref) => {
  const { t } = useLocale();

  const label = (field: string) =>
    mode === "plan"
      ? t(`core.plans.${field}`)
      : t(`core.vouchers.${field}Modifier`);

  const placeholder = (field: string) =>
    t(
      mode === "plan"
        ? `core.plans.placeholder.${field}`
        : `core.vouchers.placeholder.${field}Modifier`,
    );

  const [permissions, setPermissions] = useState<string[]>(
    Array.isArray(initialData?.permissions)
      ? [...(initialData.permissions as string[])]
      : [],
  );

  const [entityLimits, setEntityLimits] = useState<EntityLimitEntry[]>(
    mapToKV(
      (initialData?.entityLimits ??
        initialData?.entityLimitModifiers ??
        null) as Record<string, number> | null,
    ),
  );

  const [apiRateLimit, setApiRateLimit] = useState(
    String(
      (initialData?.apiRateLimit ??
        initialData?.apiRateLimitModifier ??
        (mode === "plan" ? 1000 : 0)) as number,
    ),
  );

  const storageBytes = (initialData?.storageLimitBytes ??
    initialData?.storageLimitModifier ??
    (mode === "plan" ? 1073741824 : 0)) as number;
  const [storageGB, setStorageGB] = useState(
    String(storageBytes / 1073741824),
  );

  const fileCacheBytes = (initialData?.fileCacheLimitBytes ??
    initialData?.fileCacheLimitModifier ??
    (mode === "plan" ? 20971520 : 0)) as number;
  const [fileCacheMB, setFileCacheMB] = useState(
    String(fileCacheBytes / 1048576),
  );

  const [credits, setCredits] = useState(
    String(
      (initialData?.planCredits ??
        initialData?.creditModifier ??
        0) as number,
    ),
  );

  const [maxConcurrentDownloads, setMaxConcurrentDownloads] = useState(
    String(
      (initialData?.maxConcurrentDownloads ??
        initialData?.maxConcurrentDownloadsModifier ??
        0) as number,
    ),
  );

  const [maxConcurrentUploads, setMaxConcurrentUploads] = useState(
    String(
      (initialData?.maxConcurrentUploads ??
        initialData?.maxConcurrentUploadsModifier ??
        0) as number,
    ),
  );

  const [maxDownloadBandwidth, setMaxDownloadBandwidth] = useState(
    String(
      (initialData?.maxDownloadBandwidthMB ??
        initialData?.maxDownloadBandwidthModifier ??
        0) as number,
    ),
  );

  const [maxUploadBandwidth, setMaxUploadBandwidth] = useState(
    String(
      (initialData?.maxUploadBandwidthMB ??
        initialData?.maxUploadBandwidthModifier ??
        0) as number,
    ),
  );

  const [maxOperationCount, setMaxOperationCount] = useState<
    EntityLimitEntry[]
  >(
    mapToKV(
      (initialData?.maxOperationCount ??
        initialData?.maxOperationCountModifier ??
        null) as Record<string, number> | null,
    ),
  );

  useImperativeHandle(ref, () => ({
    getData: () => {
      const entityMap = kvToMap(entityLimits);
      const opCountMap = kvToMap(maxOperationCount);

      if (mode === "plan") {
        return {
          permissions,
          entityLimits: entityMap,
          apiRateLimit: Number(apiRateLimit),
          storageLimitBytes: Math.round(Number(storageGB) * 1073741824),
          fileCacheLimitBytes: Math.round(Number(fileCacheMB) * 1048576),
          planCredits: Number(credits),
          maxConcurrentDownloads: Number(maxConcurrentDownloads),
          maxConcurrentUploads: Number(maxConcurrentUploads),
          maxDownloadBandwidthMB: Number(maxDownloadBandwidth),
          maxUploadBandwidthMB: Number(maxUploadBandwidth),
          maxOperationCount: opCountMap,
        };
      }
      return {
        permissions,
        entityLimitModifiers: entityMap,
        apiRateLimitModifier: Number(apiRateLimit),
        storageLimitModifier: Math.round(Number(storageGB) * 1073741824),
        fileCacheLimitModifier: Math.round(Number(fileCacheMB) * 1048576),
        creditModifier: Number(credits),
        maxConcurrentDownloadsModifier: Number(maxConcurrentDownloads),
        maxConcurrentUploadsModifier: Number(maxConcurrentUploads),
        maxDownloadBandwidthModifier: Number(maxDownloadBandwidth),
        maxUploadBandwidthModifier: Number(maxUploadBandwidth),
        maxOperationCountModifier: opCountMap,
      };
    },
    isValid: () => true,
  }));

  return (
    <div className="space-y-4">
      <MultiBadgeField
        name={mode === "plan"
          ? t("core.plans.permissions")
          : t("core.vouchers.permissions")}
        mode="custom"
        value={permissions}
        onChange={(vals) => setPermissions(vals as string[])}
        renderBadge={(item, remove) => (
          <TranslatedBadge
            kind="permission"
            token={typeof item === "string" ? item : item.name}
            systemSlug={systemSlug}
            onRemove={remove}
          />
        )}
      />

      <div>
        <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
          {mode === "plan"
            ? t("core.plans.entityLimits")
            : t("core.vouchers.entityLimitModifiers")}
        </label>
        <p className="text-xs text-[var(--color-light-text)]/60 mb-2">
          {mode === "plan"
            ? t("core.plans.entityLimitsHint")
            : t("core.vouchers.entityLimitModifiersHint")}
        </p>
        <DynamicKeyValueField
          fields={entityLimits}
          onChange={setEntityLimits}
          showDescription={false}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
            {label("apiRateLimit")}
          </label>
          <input
            type="number"
            value={apiRateLimit}
            onChange={(e) => setApiRateLimit(e.target.value)}
            min={mode === "plan" ? "1" : undefined}
            placeholder={placeholder("apiRateLimit")}
            className={inputCls}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
            {mode === "plan"
              ? t("core.plans.storageLimit")
              : t("core.vouchers.storageLimitModifier")} (GB)
          </label>
          <input
            type="number"
            value={storageGB}
            onChange={(e) => setStorageGB(e.target.value)}
            min="0"
            step="0.1"
            placeholder={placeholder("storageGB")}
            className={inputCls}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
            {mode === "plan"
              ? t("core.plans.fileCacheLimit")
              : t("core.vouchers.fileCacheLimitModifier")} (MB)
          </label>
          <input
            type="number"
            value={fileCacheMB}
            onChange={(e) => setFileCacheMB(e.target.value)}
            min="0"
            step="1"
            placeholder={placeholder("fileCacheMB")}
            className={inputCls}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
            {mode === "plan"
              ? t("core.plans.planCredits")
              : t("core.vouchers.creditModifier")}
          </label>
          <input
            type="number"
            value={credits}
            onChange={(e) => setCredits(e.target.value)}
            min="0"
            placeholder="0"
            className={inputCls}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
            ⬇️ {label("maxConcurrentDownloads")}
          </label>
          <input
            type="number"
            value={maxConcurrentDownloads}
            onChange={(e) => setMaxConcurrentDownloads(e.target.value)}
            min="0"
            placeholder="0"
            className={inputCls}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
            ⬆️ {label("maxConcurrentUploads")}
          </label>
          <input
            type="number"
            value={maxConcurrentUploads}
            onChange={(e) => setMaxConcurrentUploads(e.target.value)}
            min="0"
            placeholder="0"
            className={inputCls}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
            📶 {label("maxDownloadBandwidth")}
          </label>
          <input
            type="number"
            value={maxDownloadBandwidth}
            onChange={(e) => setMaxDownloadBandwidth(e.target.value)}
            min="0"
            step="0.1"
            placeholder="0"
            className={inputCls}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
            📶 {label("maxUploadBandwidth")}
          </label>
          <input
            type="number"
            value={maxUploadBandwidth}
            onChange={(e) => setMaxUploadBandwidth(e.target.value)}
            min="0"
            step="0.1"
            placeholder="0"
            className={inputCls}
          />
        </div>
        <div className="col-span-1 sm:col-span-3">
          <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
            🔢 {label("maxOperationCount")}
          </label>
          <p className="text-xs text-[var(--color-light-text)]/60 mb-2">
            {mode === "plan"
              ? t("core.plans.maxOperationCountHint")
              : t("core.vouchers.maxOperationCountModifierHint")}
          </p>
          <DynamicKeyValueField
            fields={maxOperationCount}
            onChange={setMaxOperationCount}
            showDescription={false}
          />
        </div>
      </div>
    </div>
  );
});

ResourceLimitsSubform.displayName = "ResourceLimitsSubform";
export default ResourceLimitsSubform;
