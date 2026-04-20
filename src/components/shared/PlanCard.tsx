"use client";

import { useLocale } from "@/src/hooks/useLocale";

export function formatBytes(bytes: number): string {
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

export function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
  }).format(cents / 100);
}

export function limitEmoji(key: string): string {
  const map: Record<string, string> = {
    users: "👥",
    storage: "💾",
    locations: "📍",
    leads: "👤",
    tags: "🏷️",
  };
  return map[key] ?? "📦";
}

interface PlanData {
  id: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  recurrenceDays: number;
  benefits: string[];
  permissions?: string[];
  entityLimits?: Record<string, number> | null;
  apiRateLimit: number;
  storageLimitBytes: number;
  fileCacheLimitBytes?: number;
  planCredits?: number;
  maxConcurrentDownloads?: number;
  maxConcurrentUploads?: number;
  maxDownloadBandwidthMB?: number;
  maxUploadBandwidthMB?: number;
  maxOperationCount?: Record<string, number> | null;
  isActive?: boolean;
}

export interface PlanCardProps {
  plan: PlanData;
  variant: "billing" | "onboarding" | "core";
  highlighted?: boolean;
  badges?: React.ReactNode;
  actions?: React.ReactNode;
  voucherPrice?: { original: number; effective: number; currency: string };
  onClick?: () => void;
  systemName?: string;
}

function LimitsFull({ plan }: { plan: PlanData }) {
  const { t } = useLocale();
  return (
    <div className="mb-4">
      <p className="text-xs font-semibold uppercase tracking-wider bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent mb-1">
        {t("billing.plans.limits")}
      </p>
      <div className="space-y-1 text-sm text-[var(--color-light-text)]">
        <p>
          📊 {t("billing.plans.apiRate")}: {plan.apiRateLimit.toLocaleString()}
          {" "}
          {t("billing.plans.reqPerMin")}
        </p>
        <p>
          💾 {t("billing.plans.storage")}: {formatBytes(plan.storageLimitBytes)}
        </p>
        {plan.fileCacheLimitBytes
          ? (
            <p>
              🗂️ {t("billing.plans.fileCache")}:{" "}
              {formatBytes(plan.fileCacheLimitBytes)}
            </p>
          )
          : null}
        {plan.planCredits
          ? (
            <p>
              🪙 {t("billing.plans.planCredits")}:{" "}
              {plan.planCredits.toLocaleString()}{" "}
              {t("billing.plans.creditsPerPeriod")}
            </p>
          )
          : null}
        {plan.entityLimits &&
          Object.entries(plan.entityLimits).map(([key, val]) => (
            <p key={key}>
              {limitEmoji(key)}{" "}
              {t(`billing.limits.${key}`) !== `billing.limits.${key}`
                ? t(`billing.limits.${key}`)
                : key}: {val.toLocaleString()}
            </p>
          ))}
        <p>
          ⬇️ {t("billing.limits.maxConcurrentDownloads")}:{" "}
          {plan.maxConcurrentDownloads
            ? plan.maxConcurrentDownloads
            : t("billing.limits.unlimited")}
        </p>
        <p>
          ⬆️ {t("billing.limits.maxConcurrentUploads")}:{" "}
          {plan.maxConcurrentUploads
            ? plan.maxConcurrentUploads
            : t("billing.limits.unlimited")}
        </p>
        <p>
          📶 {t("billing.limits.maxDownloadBandwidthMB")}:{" "}
          {plan.maxDownloadBandwidthMB
            ? `${plan.maxDownloadBandwidthMB} MB/s`
            : t("billing.limits.unlimited")}
        </p>
        <p>
          📶 {t("billing.limits.maxUploadBandwidthMB")}:{" "}
          {plan.maxUploadBandwidthMB
            ? `${plan.maxUploadBandwidthMB} MB/s`
            : t("billing.limits.unlimited")}
        </p>
        {plan.maxOperationCount &&
            Object.keys(plan.maxOperationCount).length > 0
          ? Object.entries(plan.maxOperationCount).map(([key, val]) => (
            <p key={key}>
              🔢 {t("billing.limits." + key) !== `billing.limits.${key}`
                ? t("billing.limits." + key)
                : key}: {val.toLocaleString()}
            </p>
          ))
          : (
            <p>
              🔢 {t("billing.limits.maxOperationCount")}:{" "}
              {t("billing.limits.unlimited")}
            </p>
          )}
      </div>
    </div>
  );
}

function LimitsCompact({ plan }: { plan: PlanData }) {
  const { t } = useLocale();
  return (
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
          {formatBytes(plan.storageLimitBytes)}
        </span>
      </div>
      <div className="flex justify-between">
        <span>🗂️ {t("core.plans.fileCache")}</span>
        <span className="text-white">
          {formatBytes(plan.fileCacheLimitBytes ?? 20971520)}
        </span>
      </div>
      <div className="flex justify-between">
        <span>{t("core.plans.planCredits")}</span>
        <span className="text-white">{plan.planCredits ?? 0}</span>
      </div>
      <div className="flex justify-between">
        <span>⬇️ {t("core.plans.maxConcurrentDownloads")}</span>
        <span className="text-white">
          {plan.maxConcurrentDownloads || t("billing.limits.unlimited")}
        </span>
      </div>
      <div className="flex justify-between">
        <span>⬆️ {t("core.plans.maxConcurrentUploads")}</span>
        <span className="text-white">
          {plan.maxConcurrentUploads || t("billing.limits.unlimited")}
        </span>
      </div>
      <div className="flex justify-between">
        <span>📶 {t("core.plans.maxDownloadBandwidthMB")}</span>
        <span className="text-white">
          {plan.maxDownloadBandwidthMB || t("billing.limits.unlimited")}
        </span>
      </div>
      <div className="flex justify-between">
        <span>📶 {t("core.plans.maxUploadBandwidthMB")}</span>
        <span className="text-white">
          {plan.maxUploadBandwidthMB || t("billing.limits.unlimited")}
        </span>
      </div>
      {plan.maxOperationCount && Object.keys(plan.maxOperationCount).length > 0
        ? Object.entries(plan.maxOperationCount).map(([key, val]) => (
          <div key={key} className="flex justify-between">
            <span>
              🔢 {t(`billing.limits.${key}`) !== `billing.limits.${key}`
                ? t(`billing.limits.${key}`)
                : key}
            </span>
            <span className="text-white">{val.toLocaleString()}</span>
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
  );
}

export default function PlanCard({
  plan,
  variant,
  highlighted = false,
  badges,
  actions,
  voucherPrice,
  onClick,
  systemName,
}: PlanCardProps) {
  const { t } = useLocale();

  const translatedName = t(plan.name) !== plan.name ? t(plan.name) : plan.name;
  const translatedDesc = plan.description
    ? (t(plan.description) !== plan.description
      ? t(plan.description)
      : plan.description)
    : null;

  const cardClass =
    `backdrop-blur-md bg-white/5 border rounded-2xl p-6 transition-all duration-200 ${
      highlighted
        ? "border-[var(--color-primary-green)] shadow-lg shadow-[var(--color-light-green)]/20 -translate-y-1"
        : onClick
        ? "border-dashed border-[var(--color-dark-gray)] hover:-translate-y-0.5 hover:shadow-lg hover:shadow-[var(--color-light-green)]/10"
        : "border-dashed border-[var(--color-dark-gray)] hover:-translate-y-1 hover:shadow-lg hover:shadow-[var(--color-light-green)]/10"
    }`;

  const inner = (
    <>
      <div className="flex items-center justify-between mb-2">
        <div>
          <h3 className="text-xl font-bold text-white">{translatedName}</h3>
          {systemName && (
            <p className="text-xs text-[var(--color-light-text)]">
              {systemName}
            </p>
          )}
        </div>
        {badges}
      </div>

      {/* Price */}
      <div className="mb-1">
        {plan.price === 0
          ? (
            <span className="bg-[var(--color-primary-green)]/20 text-[var(--color-primary-green)] px-3 py-1 rounded-full text-base">
              {t("billing.onboarding.plan.free")}
            </span>
          )
          : voucherPrice
          ? (
            <div className="flex items-center gap-2">
              <span className="line-through text-sm text-[var(--color-light-text)]">
                {formatPrice(voucherPrice.original, voucherPrice.currency)}
              </span>
              <span className="text-2xl font-bold text-[var(--color-primary-green)]">
                {formatPrice(voucherPrice.effective, voucherPrice.currency)}
              </span>
              <span className="text-xs text-[var(--color-light-text)]">
                /{plan.recurrenceDays} {t("billing.onboarding.plan.days")}
              </span>
            </div>
          )
          : (
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold text-[var(--color-primary-green)]">
                {formatPrice(plan.price, plan.currency)}
              </span>
              <span className="text-xs text-[var(--color-light-text)]">
                /{plan.recurrenceDays} {t("billing.onboarding.plan.days")}
              </span>
            </div>
          )}
      </div>

      {translatedDesc && (
        <p className="text-sm text-[var(--color-light-text)] mt-2 mb-3">
          {translatedDesc}
        </p>
      )}

      {/* Benefits */}
      {plan.benefits?.length > 0 && (
        <div className="mb-3">
          <p className="text-xs font-semibold uppercase tracking-wider bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent mb-1">
            {t("billing.plans.benefits")}
          </p>
          <ul className="space-y-1">
            {plan.benefits.map((b, i) => (
              <li
                key={i}
                className="text-sm text-[var(--color-light-text)] flex items-center gap-2"
              >
                <span className="text-[var(--color-primary-green)]">✓</span>
                {t(b) !== b ? t(b) : b}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Limits */}
      {variant === "core"
        ? <LimitsCompact plan={plan} />
        : <LimitsFull plan={plan} />}

      {/* Permissions (core only) */}
      {variant === "core" && (plan.permissions?.length ?? 0) > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {(plan.permissions ?? []).map((perm) => (
            <span
              key={perm}
              className="rounded-full bg-[var(--color-secondary-blue)]/15 px-2 py-0.5 text-xs text-[var(--color-secondary-blue)]"
            >
              {perm}
            </span>
          ))}
        </div>
      )}

      {/* Actions */}
      {actions}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`w-full text-left ${cardClass}`}
      >
        {inner}
      </button>
    );
  }

  return <div className={cardClass}>{inner}</div>;
}
