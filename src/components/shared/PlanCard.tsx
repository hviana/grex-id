"use client";

import ResourceLimitsView, {
  type ResourceLimitsData,
} from "@/src/components/shared/ResourceLimitsView";
import type {
  PlanCardProps,
  PlanView,
} from "@/src/contracts/high_level/billing-display";
import { useTenantContext } from "@/src/hooks/useTenantContext";

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

export default function PlanCard({
  plan,
  variant,
  highlighted = false,
  badges,
  actions,
  voucherPrice,
  onClick,
  systemName,
  systemSlug,
}: PlanCardProps) {
  const { t } = useTenantContext();

  const translatedName = t(plan.name) !== plan.name ? t(plan.name) : plan.name;
  const translatedDesc = plan.description
    ? (t(plan.description) !== plan.description
      ? t(plan.description)
      : plan.description)
    : null;

  const limits = plan.resourceLimitId ?? null;

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

      {/* Benefits & Limits via ResourceLimitsView */}
      {limits && (
        <ResourceLimitsView
          data={limits}
          systemSlug={systemSlug}
          className={variant === "core" ? "mt-3" : "mb-4"}
          title={variant !== "core" ? t("billing.plans.limits") : undefined}
        />
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
