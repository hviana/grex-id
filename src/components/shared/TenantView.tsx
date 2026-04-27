"use client";

import { useLocale } from "@/src/hooks/useLocale";
import type { TenantActorType } from "@/src/contracts/tenant";
import type { TenantFieldName } from "@/src/components/subforms/TenantSubform";
import TranslatedBadgeList from "@/src/components/shared/TranslatedBadgeList";

export interface TenantViewData {
  id: string;
  systemId?: string;
  systemName?: string;
  systemSlug?: string;
  companyId?: string;
  companyName?: string;
  actorId?: string;
  actorName?: string;
  actorType?: TenantActorType;
  roles?: string[];
  exchangeable?: boolean;
  frontendUse?: boolean;
  frontendDomains?: string[];
  isolateSystem?: boolean;
  isolateCompany?: boolean;
  isolateUser?: boolean;
  isAnonymous?: boolean;
}

const ALL_VIEW_FIELDS: TenantFieldName[] = [
  "companyId",
  "systemId",
  "systemSlug",
  "actorId",
  "actorType",
  "roles",
  "exchangeable",
  "frontendUse",
  "frontendDomains",
  "isolateSystem",
  "isolateCompany",
  "isolateUser",
];

interface TenantViewProps {
  tenant: TenantViewData;
  visibleFields?: TenantFieldName[];
  compact?: boolean;
}

const ACTOR_TYPE_EMOJI: Record<string, string> = {
  user: "👤",
  api_token: "🔑",
};

function ActorTypeBadge({ type }: { type?: TenantActorType }) {
  const { t } = useLocale();
  if (!type) return null;
  const emoji = ACTOR_TYPE_EMOJI[type] ?? "❓";
  const key = `core.tenant.actorType.${type}`;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-secondary-blue)]/10 border border-[var(--color-secondary-blue)]/30 px-2 py-0.5 text-xs text-[var(--color-secondary-blue)]">
      {emoji} {t(key) !== key ? t(key) : type}
    </span>
  );
}

function AnonymousBadge() {
  const { t } = useLocale();
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-white/5 border border-white/10 px-2.5 py-0.5 text-xs text-[var(--color-light-text)]">
      👻 {t("core.tenant.anonymous")}
    </span>
  );
}

function IsolationIndicator({
  label,
  on,
}: {
  label: string;
  on: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs ${
        on
          ? "text-[var(--color-primary-green)]"
          : "text-[var(--color-light-text)]/40"
      }`}
    >
      {on ? "✅" : "❌"} {label}
    </span>
  );
}

function StatusBadge({
  on,
  label,
}: {
  on: boolean;
  label: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs border ${
        on
          ? "bg-[var(--color-primary-green)]/10 border-[var(--color-primary-green)]/30 text-[var(--color-primary-green)]"
          : "bg-white/5 border-white/10 text-[var(--color-light-text)]/40"
      }`}
    >
      {on ? "✓" : "✗"} {label}
    </span>
  );
}

export default function TenantView({
  tenant,
  visibleFields = ALL_VIEW_FIELDS,
  compact = false,
}: TenantViewProps) {
  const { t } = useLocale();

  const show = (field: TenantFieldName) => visibleFields.includes(field);

  const isAnonymous = tenant.isAnonymous ||
    (tenant.roles ?? []).includes("anonymous");

  const hasCompany = show("companyId") && tenant.companyName;
  const hasSystem = show("systemId") && tenant.systemName;
  const hasActor = show("actorId") && tenant.actorName;
  const hasRoles = show("roles") && (tenant.roles?.length ?? 0) > 0;
  const hasIsolation = show("isolateSystem") || show("isolateCompany") ||
    show("isolateUser");
  const hasCors = show("frontendUse") &&
    (tenant.frontendUse || (tenant.frontendDomains?.length ?? 0) > 0);

  // Compact mode: inline summary
  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {isAnonymous && <AnonymousBadge />}
        {hasCompany && (
          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-primary-green)]/10 border border-[var(--color-primary-green)]/30 px-2.5 py-0.5 text-xs text-[var(--color-primary-green)]">
            🏢 {tenant.companyName}
          </span>
        )}
        {hasSystem && (
          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-secondary-blue)]/10 border border-[var(--color-secondary-blue)]/30 px-2.5 py-0.5 text-xs text-[var(--color-secondary-blue)]">
            🖥️ {tenant.systemName}
            {tenant.systemSlug && tenant.systemSlug !== tenant.systemName && (
              <span className="opacity-60">({tenant.systemSlug})</span>
            )}
          </span>
        )}
        {hasActor && (
          <span className="inline-flex items-center gap-1 rounded-full bg-white/5 border border-white/10 px-2.5 py-0.5 text-xs text-white">
            {ACTOR_TYPE_EMOJI[tenant.actorType ?? "user"] ?? "👤"}{" "}
            {tenant.actorName}
          </span>
        )}
        {hasRoles && (
          <TranslatedBadgeList
            kind="role"
            tokens={tenant.roles}
            systemSlug={tenant.systemSlug}
            compact
          />
        )}
      </div>
    );
  }

  // Full card mode
  return (
    <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-5 space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2">
        {isAnonymous && <AnonymousBadge />}
        {show("actorType") && tenant.actorType && (
          <ActorTypeBadge type={tenant.actorType} />
        )}
      </div>

      {/* Identity section */}
      {(hasCompany || hasSystem || hasActor) && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent">
            {t("core.tenant.view.identity")}
          </p>
          {hasCompany && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-[var(--color-light-text)]">🏢</span>
              <span className="text-white font-medium">
                {tenant.companyName}
              </span>
            </div>
          )}
          {hasSystem && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-[var(--color-light-text)]">🖥️</span>
              <span className="text-white font-medium">
                {tenant.systemName}
              </span>
              {tenant.systemSlug && tenant.systemSlug !== tenant.systemName && (
                <span className="text-xs text-[var(--color-light-text)]/60">
                  ({tenant.systemSlug})
                </span>
              )}
            </div>
          )}
          {hasActor && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-[var(--color-light-text)]">
                {ACTOR_TYPE_EMOJI[tenant.actorType ?? "user"] ?? "👤"}
              </span>
              <span className="text-white font-medium">
                {tenant.actorName}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Authorization section */}
      {(hasRoles || (show("exchangeable") && tenant.exchangeable)) && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent">
            {t("core.tenant.view.authorization")}
          </p>
          {hasRoles && (
            <TranslatedBadgeList
              kind="role"
              tokens={tenant.roles}
              systemSlug={tenant.systemSlug}
              compact
            />
          )}
          {show("exchangeable") && (
            <StatusBadge
              on={!!tenant.exchangeable}
              label={t("core.tenant.exchangeable")}
            />
          )}
        </div>
      )}

      {/* Access control section */}
      {hasIsolation && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent">
            {t("core.tenant.view.accessControl")}
          </p>
          <div className="flex flex-wrap gap-3">
            {show("isolateSystem") && (
              <IsolationIndicator
                label={t("core.tenant.isolateSystem")}
                on={!!tenant.isolateSystem}
              />
            )}
            {show("isolateCompany") && (
              <IsolationIndicator
                label={t("core.tenant.isolateCompany")}
                on={!!tenant.isolateCompany}
              />
            )}
            {show("isolateUser") && (
              <IsolationIndicator
                label={t("core.tenant.isolateUser")}
                on={!!tenant.isolateUser}
              />
            )}
          </div>
        </div>
      )}

      {/* CORS section */}
      {hasCors && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent">
            {t("core.tenant.view.cors")}
          </p>
          <StatusBadge
            on={!!tenant.frontendUse}
            label={t("core.tenant.frontendUse")}
          />
          {tenant.frontendDomains && tenant.frontendDomains.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {tenant.frontendDomains.map((domain) => (
                <span
                  key={domain}
                  className="inline-flex items-center rounded-full bg-[var(--color-secondary-blue)]/10 border border-[var(--color-secondary-blue)]/20 px-2 py-0.5 text-xs text-[var(--color-secondary-blue)]"
                >
                  🌐 {domain}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
