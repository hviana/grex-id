"use client";

import ResourceLimitsView from "@/src/components/shared/ResourceLimitsView";
import type { ResourceLimitsData } from "@/src/contracts/high-level/resource-limits";
import type {
  PlanCardProps,
  PlanView,
} from "@/src/contracts/high-level/billing-display";
import { useTenantContext } from "@/src/hooks/useTenantContext";
import {
  effectivePrice as calcEffectivePrice,
  mergeResourceLimits,
} from "@/src/lib/merge-resource-limits";

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
  voucher,
  highlighted = false,
  badges,
  actions,
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

  const cascade = (plan as Record<string, unknown>)._cascade as
    | Record<string, unknown>
    | undefined;
  const rlCascade = cascade?.resourceLimitId as
    | Record<string, unknown>
    | undefined;
  const roleNames = (rlCascade?._cascade as Record<string, unknown> | undefined)
    ?.roleIds as { name: string }[] | undefined;
  const baseLimits: ResourceLimitsData | null = rlCascade
    ? ({
      ...rlCascade,
      roleIds: roleNames?.map((r) => r.name) ??
        (rlCascade.roleIds as string[]),
    } as ResourceLimitsData)
    : null;
  const voucherLimits = voucher?.resourceLimitId ?? null;
  const merged = voucher
    ? mergeResourceLimits(baseLimits, voucherLimits)
    : baseLimits;

  const priceModifier = voucher?.priceModifier ?? 0;
  const effectivePlanPrice = calcEffectivePrice(plan.price, priceModifier);

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
        {effectivePlanPrice === 0 && !voucher
          ? (
            <span className="bg-[var(--color-primary-green)]/20 text-[var(--color-primary-green)] px-3 py-1 rounded-full text-base">
              {t("billing.onboarding.plan.free")}
            </span>
          )
          : (
            <div className="flex items-baseline gap-1">
              {voucher && priceModifier !== 0 && plan.price > 0 && (
                <span className="line-through text-sm text-[var(--color-light-text)] mr-1">
                  {formatPrice(plan.price, plan.currency)}
                </span>
              )}
              {effectivePlanPrice === 0
                ? (
                  <span className="bg-[var(--color-primary-green)]/20 text-[var(--color-primary-green)] px-3 py-1 rounded-full text-base">
                    {t("billing.onboarding.plan.free")}
                  </span>
                )
                : (
                  <>
                    <span className="text-2xl font-bold text-[var(--color-primary-green)]">
                      {formatPrice(effectivePlanPrice, plan.currency)}
                    </span>
                    <span className="text-xs text-[var(--color-light-text)]">
                      /{plan.recurrenceDays} {t("billing.onboarding.plan.days")}
                    </span>
                  </>
                )}
            </div>
          )}
      </div>

      {/* Voucher name badge */}
      {voucher && (
        <div className="mb-2">
          <span className="inline-flex items-center gap-1 text-xs bg-[var(--color-primary-green)]/10 border border-[var(--color-primary-green)]/30 text-[var(--color-primary-green)] px-2 py-0.5 rounded-full">
            🏷️ {voucher.name}
          </span>
        </div>
      )}

      {translatedDesc && (
        <p className="text-sm text-[var(--color-light-text)] mt-2 mb-3">
          {translatedDesc}
        </p>
      )}

      {/* Benefits & Limits via ResourceLimitsView (merged) */}
      {merged && (
        <ResourceLimitsView
          data={merged}
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
