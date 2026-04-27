"use client";

import { useLocale } from "@/src/hooks/useLocale";
import TranslatedBadgeList from "@/src/components/shared/TranslatedBadgeList";
import { formatBytes, limitEmoji } from "@/src/components/shared/PlanCard";

export interface ResourceLimitsData {
  benefits?: string[] | null;
  roles?: string[] | null;
  entityLimits?: Record<string, number> | null;
  apiRateLimit?: number;
  storageLimitBytes?: number;
  fileCacheLimitBytes?: number;
  credits?: number;
  maxConcurrentDownloads?: number;
  maxConcurrentUploads?: number;
  maxDownloadBandwidthMB?: number;
  maxUploadBandwidthMB?: number;
  maxOperationCountByResourceKey?: Record<string, number> | null;
  creditLimitByResourceKey?: Record<string, number> | null;
  frontendDomains?: string[] | null;
}

interface ResourceLimitsViewProps {
  data: ResourceLimitsData;
  systemSlug?: string;
  title?: string;
  className?: string;
  /** When true, numeric values are displayed as signed modifiers (+/-). */
  modifier?: boolean;
}

function has<T>(value: T | null | undefined): value is T {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object" && !Array.isArray(value)) {
    return Object.keys(value as object).length > 0;
  }
  return true;
}

function fmtModifier(value: number): string {
  if (value > 0) return `+${value}`;
  return String(value);
}

function domainBadge(domain: string) {
  return (
    <span
      key={domain}
      className="inline-flex items-center rounded-full border border-[var(--color-dark-gray)] bg-white/5 px-2.5 py-0.5 text-xs text-[var(--color-light-text)]"
    >
      🌐 {domain}
    </span>
  );
}

export default function ResourceLimitsView({
  data,
  systemSlug,
  title,
  className = "",
  modifier = false,
}: ResourceLimitsViewProps) {
  const { t } = useLocale();

  const unlimited = t("billing.limits.unlimited");
  const num = (v: number) => (modifier ? fmtModifier(v) : v.toLocaleString());

  return (
    <div
      className={`space-y-3 text-sm text-[var(--color-light-text)] ${className}`}
    >
      {title && (
        <p className="text-xs font-semibold uppercase tracking-wider bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent">
          {title}
        </p>
      )}

      {has(data.benefits) && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-light-text)] mb-1">
            {t("billing.plans.benefits")}
          </p>
          <ul className="space-y-0.5">
            {data.benefits.map((b, i) => (
              <li
                key={i}
                className="text-sm text-[var(--color-light-text)] flex items-center gap-2"
              >
                <span className="text-[var(--color-primary-green)] text-xs">
                  ✓
                </span>
                {t(b) !== b ? t(b) : b}
              </li>
            ))}
          </ul>
        </div>
      )}

      {has(data.roles) && (
        <TranslatedBadgeList
          kind="role"
          tokens={data.roles}
          systemSlug={systemSlug}
          compact
          title={t("core.plans.roles")}
        />
      )}

      {has(data.entityLimits) && (
        <TranslatedBadgeList
          kind="entity"
          entries={data.entityLimits}
          systemSlug={systemSlug}
          compact
          mode="column"
          prefix={(key) => limitEmoji(key)}
          formatValue={modifier ? (v) => fmtModifier(Number(v)) : undefined}
          title={t("core.plans.entityLimits")}
        />
      )}

      {(has(data.apiRateLimit) || has(data.storageLimitBytes) ||
        has(data.fileCacheLimitBytes) || has(data.credits)) && (
        <div className="space-y-1">
          {has(data.apiRateLimit) && (
            <p>
              📊 {t("billing.plans.apiRate")}: {num(data.apiRateLimit!)}{" "}
              {!modifier && t("billing.plans.reqPerMin")}
            </p>
          )}
          {has(data.storageLimitBytes) && (
            <p>
              💾 {t("billing.plans.storage")}: {modifier
                ? `${fmtModifier(data.storageLimitBytes! / 1073741824)} GB`
                : formatBytes(data.storageLimitBytes!)}
            </p>
          )}
          {has(data.fileCacheLimitBytes) && (
            <p>
              🗂️ {t("billing.plans.fileCache")}: {modifier
                ? `${fmtModifier(data.fileCacheLimitBytes! / 1048576)} MB`
                : formatBytes(data.fileCacheLimitBytes!)}
            </p>
          )}
          {has(data.credits) && (
            <p>
              🪙 {t("billing.plans.planCredits")}: {num(data.credits!)}{" "}
              {!modifier && t("billing.plans.creditsPerPeriod")}
            </p>
          )}
        </div>
      )}

      {(has(data.maxConcurrentDownloads) || has(data.maxConcurrentUploads) ||
        has(data.maxDownloadBandwidthMB) || has(data.maxUploadBandwidthMB)) && (
        <div className="space-y-1">
          {has(data.maxConcurrentDownloads) && (
            <p>
              ⬇️ {t("billing.limits.maxConcurrentDownloads")}: {modifier
                ? fmtModifier(data.maxConcurrentDownloads!)
                : data.maxConcurrentDownloads
                ? data.maxConcurrentDownloads
                : unlimited}
            </p>
          )}
          {has(data.maxConcurrentUploads) && (
            <p>
              ⬆️ {t("billing.limits.maxConcurrentUploads")}: {modifier
                ? fmtModifier(data.maxConcurrentUploads!)
                : data.maxConcurrentUploads
                ? data.maxConcurrentUploads
                : unlimited}
            </p>
          )}
          {has(data.maxDownloadBandwidthMB) && (
            <p>
              📶 {t("billing.limits.maxDownloadBandwidthMB")}: {modifier
                ? `${fmtModifier(data.maxDownloadBandwidthMB!)} MB/s`
                : data.maxDownloadBandwidthMB
                ? `${data.maxDownloadBandwidthMB} MB/s`
                : unlimited}
            </p>
          )}
          {has(data.maxUploadBandwidthMB) && (
            <p>
              📶 {t("billing.limits.maxUploadBandwidthMB")}: {modifier
                ? `${fmtModifier(data.maxUploadBandwidthMB!)} MB/s`
                : data.maxUploadBandwidthMB
                ? `${data.maxUploadBandwidthMB} MB/s`
                : unlimited}
            </p>
          )}
        </div>
      )}

      {has(data.maxOperationCountByResourceKey) && (
        <TranslatedBadgeList
          kind="resource"
          entries={data.maxOperationCountByResourceKey}
          systemSlug={systemSlug}
          compact
          mode="column"
          prefix="🔢"
          formatValue={modifier ? (v) => fmtModifier(Number(v)) : undefined}
          title={t("billing.limits.maxOperationCountByResourceKey")}
        />
      )}

      {has(data.creditLimitByResourceKey) && (
        <TranslatedBadgeList
          kind="resource"
          entries={data.creditLimitByResourceKey}
          systemSlug={systemSlug}
          compact
          mode="column"
          prefix="🪙"
          formatValue={modifier ? (v) => fmtModifier(Number(v)) : undefined}
          title={t("billing.limits.creditLimitByResourceKey")}
        />
      )}

      {has(data.frontendDomains) && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-light-text)] mb-1">
            🌐 {t("core.plans.frontendDomains")}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {data.frontendDomains.map(domainBadge)}
          </div>
        </div>
      )}
    </div>
  );
}
