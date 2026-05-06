"use client";

import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import type { SubformRef } from "@/src/contracts/high-level/components";
import type { BadgeValue } from "@/src/contracts/high-level/components";
import MultiBadgeField from "@/src/components/fields/MultiBadgeField";
import DynamicKeyValueField from "@/src/components/fields/DynamicKeyValueField";
import TranslatedBadge from "@/src/components/shared/TranslatedBadge";
import { useTenantContext } from "@/src/hooks/useTenantContext";
import type { ResourceLimitField } from "@/src/contracts/high-level/resource-limits";
import type { KeyValueEntry } from "@/src/contracts/high-level/components";

function mapToKV(map: Record<string, number> | null): KeyValueEntry[] {
  if (!map) return [];
  return Object.entries(map).map(([key, val]) => ({
    key,
    value: String(val),
    description: "",
  }));
}

function kvToMap(kv: KeyValueEntry[]): Record<string, number> | null {
  const filtered = kv.filter((e) => e.key.trim() && e.value.trim());
  if (filtered.length === 0) return null;
  const result: Record<string, number> = {};
  for (const entry of filtered) {
    result[entry.key.trim()] = Number(entry.value);
  }
  return result;
}

const FIELD_LABELS: Record<ResourceLimitField, string> = {
  benefits: "⭐",
  roleIds: "🔑",
  entityLimits: "📦",
  apiRateLimit: "📊",
  storageLimitBytes: "💾",
  fileCacheLimitBytes: "🗂️",
  credits: "🪙",
  priceModifier: "💲",
  maxConcurrentDownloads: "⬇️",
  maxConcurrentUploads: "⬆️",
  maxDownloadBandwidthMB: "📶⬇",
  maxUploadBandwidthMB: "📶⬆",
  maxOperationCountByResourceKey: "🔢",
  creditLimitByResourceKey: "🪙🔑",
  frontendDomains: "🌐",
};

const FIELD_ORDER: ResourceLimitField[] = [
  "benefits",
  "roleIds",
  "entityLimits",
  "apiRateLimit",
  "storageLimitBytes",
  "fileCacheLimitBytes",
  "credits",
  "priceModifier",
  "maxConcurrentDownloads",
  "maxConcurrentUploads",
  "maxDownloadBandwidthMB",
  "maxUploadBandwidthMB",
  "maxOperationCountByResourceKey",
  "creditLimitByResourceKey",
  "frontendDomains",
];

/** Fields that are "present" in initialData — used to pre-select checkboxes. */
function initialSelectedFields(
  initialData: Record<string, unknown> | undefined,
): Set<ResourceLimitField> {
  const selected = new Set<ResourceLimitField>();
  if (!initialData) return selected;
  for (const field of FIELD_ORDER) {
    const v = initialData[field];
    if (v === null || v === undefined) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (
      typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0
    ) continue;
    selected.add(field);
  }
  return selected;
}

import type { ResourceLimitsSubformProps } from "@/src/contracts/high-level/component-props";

const inputCls =
  "w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-2.5 text-white placeholder-white/30 outline-none focus:border-[var(--color-primary-green)] transition-colors";

const ResourceLimitsSubform = forwardRef<
  SubformRef,
  ResourceLimitsSubformProps
>((
  {
    valueMode,
    initialData,
    systemSlug,
    systemId: systemIdProp,
    initialGranular,
  },
  ref,
) => {
  const { t } = useTenantContext();

  const isAbsolute = valueMode === "absolute";

  const { systemToken, systemId: contextSystemId } = useTenantContext();
  const systemId = systemIdProp ?? contextSystemId;

  const authHeaders = useMemo(
    () =>
      systemToken
        ? { Authorization: `Bearer ${systemToken}` }
        : ({} as Record<string, string>),
    [systemToken],
  );

  const fetchRoles = useCallback(
    async (search: string): Promise<BadgeValue[]> => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (systemId) params.set("systemId", systemId);
      if (initialGranular !== undefined) {
        params.set("granular", String(initialGranular));
      }
      const res = await fetch(`/api/core/roles?${params}`, {
        headers: authHeaders,
      });
      const json = await res.json();
      return (json.items ?? []).map(
        (r: { id: string; name: string }) => ({
          id: String(r.id),
          name: r.name,
        }),
      );
    },
    [authHeaders, systemId, initialGranular],
  );

  const [selectedFields, setSelectedFields] = useState<Set<ResourceLimitField>>(
    () => initialSelectedFields(initialData),
  );

  const show = (field: ResourceLimitField) => selectedFields.has(field);

  const toggleField = (field: ResourceLimitField) => {
    setSelectedFields((prev) => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  };

  const label = (field: string) =>
    isAbsolute
      ? t(`core.resourceLimits.${field}`)
      : t(`core.resourceLimits.${field}Modifier`);

  const hint = (field: string) => t(`core.resourceLimits.${field}Hint`);

  const placeholder = (field: string) =>
    t(`core.resourceLimits.placeholder.${field}`);

  const [benefits, setBenefits] = useState<string[]>(
    Array.isArray(initialData?.benefits)
      ? [...(initialData.benefits as string[])]
      : [],
  );

  const [roleIds, setRoleIds] = useState<string[]>(
    Array.isArray(initialData?.roleIds)
      ? [...(initialData.roleIds as string[])]
      : [],
  );

  const [entityLimits, setEntityLimits] = useState<KeyValueEntry[]>(
    mapToKV(
      (initialData?.entityLimits ?? null) as Record<string, number> | null,
    ),
  );

  const [apiRateLimit, setApiRateLimit] = useState(
    String((initialData?.apiRateLimit ?? (isAbsolute ? 1000 : 0)) as number),
  );

  const storageBytes =
    (initialData?.storageLimitBytes ?? (isAbsolute ? 1073741824 : 0)) as number;
  const [storageGB, setStorageGB] = useState(
    String(storageBytes / 1073741824),
  );

  const fileCacheBytes =
    (initialData?.fileCacheLimitBytes ?? (isAbsolute ? 20971520 : 0)) as number;
  const [fileCacheMB, setFileCacheMB] = useState(
    String(fileCacheBytes / 1048576),
  );

  const [credits, setCredits] = useState(
    String((initialData?.credits ?? 0) as number),
  );

  const [priceModifier, setPriceModifier] = useState(
    String((initialData?.priceModifier ?? 0) as number),
  );

  const [maxConcurrentDownloads, setMaxConcurrentDownloads] = useState(
    String((initialData?.maxConcurrentDownloads ?? 0) as number),
  );

  const [maxConcurrentUploads, setMaxConcurrentUploads] = useState(
    String((initialData?.maxConcurrentUploads ?? 0) as number),
  );

  const [maxDownloadBandwidth, setMaxDownloadBandwidth] = useState(
    String((initialData?.maxDownloadBandwidthMB ?? 0) as number),
  );

  const [maxUploadBandwidth, setMaxUploadBandwidth] = useState(
    String((initialData?.maxUploadBandwidthMB ?? 0) as number),
  );

  const [maxOperationCountByResourceKey, setMaxOperationCountByResourceKey] =
    useState<
      KeyValueEntry[]
    >(
      mapToKV(
        (initialData?.maxOperationCountByResourceKey ?? null) as
          | Record<string, number>
          | null,
      ),
    );

  const [creditLimitByResourceKey, setCreditLimitByResourceKey] = useState<
    KeyValueEntry[]
  >(
    mapToKV(
      (initialData?.creditLimitByResourceKey ?? null) as
        | Record<
          string,
          number
        >
        | null,
    ),
  );

  const [frontendDomains, setFrontendDomains] = useState<string[]>(
    Array.isArray(initialData?.frontendDomains)
      ? [...(initialData.frontendDomains as string[])]
      : [],
  );

  useImperativeHandle(ref, () => ({
    getData: () => {
      const result: Record<string, unknown> = {};

      if (show("benefits")) result.benefits = benefits;
      if (show("roleIds")) result.roleIds = roleIds;
      if (show("entityLimits")) result.entityLimits = kvToMap(entityLimits);
      if (show("apiRateLimit")) result.apiRateLimit = Number(apiRateLimit);
      if (show("storageLimitBytes")) {
        result.storageLimitBytes = Math.round(Number(storageGB) * 1073741824);
      }
      if (show("fileCacheLimitBytes")) {
        result.fileCacheLimitBytes = Math.round(Number(fileCacheMB) * 1048576);
      }
      if (show("credits")) result.credits = Number(credits);
      if (show("priceModifier")) result.priceModifier = Number(priceModifier);
      if (show("maxConcurrentDownloads")) {
        result.maxConcurrentDownloads = Number(maxConcurrentDownloads);
      }
      if (show("maxConcurrentUploads")) {
        result.maxConcurrentUploads = Number(maxConcurrentUploads);
      }
      if (show("maxDownloadBandwidthMB")) {
        result.maxDownloadBandwidthMB = Number(maxDownloadBandwidth);
      }
      if (show("maxUploadBandwidthMB")) {
        result.maxUploadBandwidthMB = Number(maxUploadBandwidth);
      }
      if (show("maxOperationCountByResourceKey")) {
        result.maxOperationCountByResourceKey = kvToMap(
          maxOperationCountByResourceKey,
        );
      }
      if (show("creditLimitByResourceKey")) {
        result.creditLimitByResourceKey = kvToMap(creditLimitByResourceKey);
      }
      if (show("frontendDomains")) {
        result.frontendDomains = frontendDomains.length > 0
          ? frontendDomains
          : null;
      }

      return result;
    },
    isValid: () => true,
  }));

  return (
    <div className="space-y-4">
      {/* Compact checkbox toggles */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-light-text)] mb-2">
          {t("core.resourceLimits.selectFields")}
        </p>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {FIELD_ORDER.map((field) => (
            <label
              key={field}
              className="inline-flex items-center gap-1 text-xs text-[var(--color-light-text)] cursor-pointer hover:text-white transition-colors"
            >
              <input
                type="checkbox"
                checked={selectedFields.has(field)}
                onChange={() => toggleField(field)}
                className="h-3 w-3 rounded border-[var(--color-dark-gray)] accent-[var(--color-primary-green)] cursor-pointer"
              />
              <span className="select-none">
                {FIELD_LABELS[field]}
              </span>
            </label>
          ))}
        </div>
      </div>

      {show("benefits") && (
        <MultiBadgeField
          name={t("core.resourceLimits.benefits")}
          mode="custom"
          value={benefits}
          onChange={(vals) => setBenefits(vals as string[])}
          formatHint={t("core.resourceLimits.benefitsHint")}
        />
      )}

      {show("roleIds") && (
        <MultiBadgeField
          name={t("core.resourceLimits.roleIds")}
          mode="search"
          value={roleIds.map((id) => ({ id, name: id }))}
          onChange={(vals) =>
            setRoleIds(
              vals.map((v) => typeof v === "string" ? v : v.id ?? v.name),
            )}
          fetchFn={fetchRoles}
          formatHint={t("core.resourceLimits.roleIdsHint")}
          renderBadge={(item, remove) => (
            <TranslatedBadge
              kind="role"
              token={typeof item === "string" ? item : item.name}
              systemSlug={systemSlug}
              onRemove={remove}
            />
          )}
        />
      )}

      {show("entityLimits") && (
        <div>
          <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
            {isAbsolute
              ? t("core.resourceLimits.entityLimits")
              : t("core.resourceLimits.entityLimitModifiers")}
          </label>
          <p className="text-xs text-[var(--color-light-text)]/60 mb-2">
            {isAbsolute
              ? t("core.resourceLimits.entityLimitsHint")
              : t("core.resourceLimits.entityLimitModifiersHint")}
          </p>
          <DynamicKeyValueField
            fields={entityLimits}
            onChange={setEntityLimits}
            showDescription={false}
          />
        </div>
      )}

      {(show("apiRateLimit") || show("storageLimitBytes") ||
        show("fileCacheLimitBytes")) && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {show("apiRateLimit") && (
            <div>
              <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
                {label("apiRateLimit")}
              </label>
              <input
                type="number"
                value={apiRateLimit}
                onChange={(e) => setApiRateLimit(e.target.value)}
                min={isAbsolute ? "1" : undefined}
                placeholder={placeholder("apiRateLimit")}
                className={inputCls}
              />
            </div>
          )}
          {show("storageLimitBytes") && (
            <div>
              <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
                {label("storageLimit")} (GB)
              </label>
              <input
                type="number"
                value={storageGB}
                onChange={(e) => setStorageGB(e.target.value)}
                min={isAbsolute ? "0" : undefined}
                step="0.1"
                placeholder={placeholder("storageLimit")}
                className={inputCls}
              />
            </div>
          )}
          {show("fileCacheLimitBytes") && (
            <div>
              <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
                {label("fileCacheLimit")} (MB)
              </label>
              <input
                type="number"
                value={fileCacheMB}
                onChange={(e) => setFileCacheMB(e.target.value)}
                min={isAbsolute ? "0" : undefined}
                step="1"
                placeholder={placeholder("fileCacheLimit")}
                className={inputCls}
              />
            </div>
          )}
        </div>
      )}

      {(show("credits") || show("priceModifier") ||
        show("maxConcurrentDownloads") ||
        show("maxConcurrentUploads")) && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {show("credits") && (
            <div>
              <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
                {label("credits")}
              </label>
              <input
                type="number"
                value={credits}
                onChange={(e) => setCredits(e.target.value)}
                min={isAbsolute ? "0" : undefined}
                placeholder="0"
                className={inputCls}
              />
            </div>
          )}
          {show("priceModifier") && (
            <div>
              <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
                💲 {label("priceModifier")}
              </label>
              <input
                type="number"
                value={priceModifier}
                onChange={(e) => setPriceModifier(e.target.value)}
                placeholder="0"
                className={inputCls}
              />
            </div>
          )}
          {show("maxConcurrentDownloads") && (
            <div>
              <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
                ⬇️ {label("maxConcurrentDownloads")}
              </label>
              <input
                type="number"
                value={maxConcurrentDownloads}
                onChange={(e) => setMaxConcurrentDownloads(e.target.value)}
                min={isAbsolute ? "0" : undefined}
                placeholder="0"
                className={inputCls}
              />
            </div>
          )}
          {show("maxConcurrentUploads") && (
            <div>
              <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
                ⬆️ {label("maxConcurrentUploads")}
              </label>
              <input
                type="number"
                value={maxConcurrentUploads}
                onChange={(e) => setMaxConcurrentUploads(e.target.value)}
                min={isAbsolute ? "0" : undefined}
                placeholder="0"
                className={inputCls}
              />
            </div>
          )}
        </div>
      )}

      {(show("maxDownloadBandwidthMB") || show("maxUploadBandwidthMB") ||
        show("maxOperationCountByResourceKey")) && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {show("maxDownloadBandwidthMB") && (
            <div>
              <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
                📶 {label("maxDownloadBandwidthMB")}
              </label>
              <input
                type="number"
                value={maxDownloadBandwidth}
                onChange={(e) => setMaxDownloadBandwidth(e.target.value)}
                min={isAbsolute ? "0" : undefined}
                step="0.1"
                placeholder="0"
                className={inputCls}
              />
            </div>
          )}
          {show("maxUploadBandwidthMB") && (
            <div>
              <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
                📶 {label("maxUploadBandwidthMB")}
              </label>
              <input
                type="number"
                value={maxUploadBandwidth}
                onChange={(e) => setMaxUploadBandwidth(e.target.value)}
                min={isAbsolute ? "0" : undefined}
                step="0.1"
                placeholder="0"
                className={inputCls}
              />
            </div>
          )}
          {show("maxOperationCountByResourceKey") && (
            <div className="col-span-1 sm:col-span-3">
              <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
                🔢 {label("maxOperationCountByResourceKey")}
              </label>
              <p className="text-xs text-[var(--color-light-text)]/60 mb-2">
                {hint("maxOperationCountByResourceKey")}
              </p>
              <DynamicKeyValueField
                fields={maxOperationCountByResourceKey}
                onChange={setMaxOperationCountByResourceKey}
                showDescription={false}
              />
            </div>
          )}
        </div>
      )}

      {show("creditLimitByResourceKey") && (
        <div>
          <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
            🪙 {label("creditLimitByResourceKey")}
          </label>
          <p className="text-xs text-[var(--color-light-text)]/60 mb-2">
            {hint("creditLimitByResourceKey")}
          </p>
          <DynamicKeyValueField
            fields={creditLimitByResourceKey}
            onChange={setCreditLimitByResourceKey}
            showDescription={false}
          />
        </div>
      )}

      {show("frontendDomains") && (
        <div>
          <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
            🌐 {label("frontendDomains")}
          </label>
          <p className="text-xs text-[var(--color-light-text)]/60 mb-2">
            {hint("frontendDomains")}
          </p>
          <MultiBadgeField
            name={label("frontendDomains")}
            mode="custom"
            value={frontendDomains}
            onChange={(vals) => setFrontendDomains(vals as string[])}
            hideLabel
          />
        </div>
      )}
    </div>
  );
});

ResourceLimitsSubform.displayName = "ResourceLimitsSubform";
export default ResourceLimitsSubform;
