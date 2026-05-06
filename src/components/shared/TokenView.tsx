"use client";

import { useTenantContext } from "@/src/hooks/useTenantContext";
import TenantView from "@/src/components/shared/TenantView";
import ResourceLimitsView from "@/src/components/shared/ResourceLimitsView";
import DateView from "@/src/components/shared/DateView";
import type { TokenViewProps } from "@/src/contracts/high-level/component-props";

const ACTOR_TYPE_ICON: Record<string, string> = {
  app: "📱",
  token: "🔑",
};

export default function TokenView(
  { token, systemSlug, controls }: TokenViewProps,
) {
  const { t } = useTenantContext();

  const actorTypeLabel = token.actorType === "app"
    ? t("common.tokens.actorTypeApp")
    : t("common.tokens.actorTypeToken");

  return (
    <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-4 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-[var(--color-light-green)]/10 transition-all duration-200">
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 rounded-full bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] flex items-center justify-center text-black font-bold text-sm shrink-0">
          {ACTOR_TYPE_ICON[token.actorType] ?? "🔑"}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-white truncate">
              {token.name}
            </h3>
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-secondary-blue)]/10 border border-[var(--color-secondary-blue)]/30 px-2 py-0.5 text-xs text-[var(--color-secondary-blue)] shrink-0">
              {actorTypeLabel}
            </span>
          </div>
          {token.description && (
            <p className="text-sm text-[var(--color-light-text)] truncate mt-0.5">
              {token.description}
            </p>
          )}
          <p className="text-xs text-[var(--color-light-text)]/60 mt-0.5">
            {t("common.createdAt")}:{" "}
            <DateView mode="date" value={token.createdAt} />
            {token.expiresAt && (
              <>
                {" · "}
                {t("common.expires")}:{" "}
                <DateView mode="date" value={token.expiresAt} />
              </>
            )}
          </p>
        </div>

        <div className="shrink-0">
          <TenantView
            tenant={{
              id: token.id,
              roles: token._resourceLimitRoleNames ??
                token.resourceLimitId?.roleIds ?? undefined,
            }}
            visibleFields={["roleIds"]}
            compact
          />
        </div>

        {controls && <div className="flex gap-1 shrink-0">{controls}</div>}
      </div>

      {token.resourceLimitId && (
        <ResourceLimitsView
          data={token.resourceLimitId}
          systemSlug={systemSlug}
          className="mt-3"
        />
      )}
    </div>
  );
}
