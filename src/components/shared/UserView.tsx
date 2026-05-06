"use client";

import type { ReactNode } from "react";
import { useTenantContext } from "@/src/hooks/useTenantContext";
import TenantView from "@/src/components/shared/TenantView";
import ResourceLimitsView from "@/src/components/shared/ResourceLimitsView";
import type { ResourceLimitsData } from "@/src/contracts/high-level/resource-limits";
import type { UserViewData } from "@/src/contracts/high-level/user";

function ensureChannelArray(
  channelIds: unknown,
): { id: string; type: string; value: string; verified: boolean }[] {
  return Array.isArray(channelIds) ? channelIds : [];
}

export function userPrimaryChannel(
  user: UserViewData,
): string {
  const channels = ensureChannelArray(user.channelIds);
  const email = channels.find((c) => c.type === "email");
  if (email?.value) return email.value;
  const verified = channels.find((c) => c.verified);
  if (verified?.value) return verified.value;
  return channels[0]?.value ?? "";
}

export function userHasVerifiedChannel(user: UserViewData): boolean {
  return ensureChannelArray(user.channelIds).some((c) => c.verified);
}

export function userFirstUnverifiedChannelId(
  user: UserViewData,
): string | null {
  return ensureChannelArray(user.channelIds).find((c) => !c.verified)?.id ??
    null;
}

import type { UserViewProps } from "@/src/contracts/high-level/component-props";

export default function UserView(
  { user, systemSlug, controls, groupNames }: UserViewProps,
) {
  const { t } = useTenantContext();
  const isVerified = userHasVerifiedChannel(user);
  const primary = userPrimaryChannel(user);
  const displayName = user.profileId?.name ?? primary;

  return (
    <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-4 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-[var(--color-light-green)]/10 transition-all duration-200">
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 rounded-full bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] flex items-center justify-center text-black font-bold text-sm shrink-0">
          {displayName.charAt(0).toUpperCase()}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-white truncate">
              {displayName}
            </h3>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs border shrink-0 ${
                isVerified
                  ? "bg-[var(--color-primary-green)]/10 border-[var(--color-primary-green)]/30 text-[var(--color-primary-green)]"
                  : "bg-yellow-500/10 border-yellow-500/30 text-yellow-400"
              }`}
            >
              {isVerified ? "✓ " : ""}
              {isVerified
                ? t("common.entityChannels.verified")
                : t("common.entityChannels.unverified")}
            </span>
          </div>
          {primary && (
            <p className="text-sm text-[var(--color-light-text)] truncate">
              {primary}
            </p>
          )}
        </div>

        <div className="shrink-0">
          <TenantView
            tenant={{
              id: user.id,
              roles: user._resourceLimitRoleNames ?? user.contextRoles ?? [],
              groupIds: groupNames,
              systemSlug,
            }}
            visibleFields={["roleIds", "groupIds"]}
            compact
          />
        </div>

        {controls && <div className="flex gap-1 shrink-0">{controls}</div>}
      </div>

      {user.resourceLimitId && (
        <ResourceLimitsView
          data={{
            ...user.resourceLimitId,
            roleIds: user._resourceLimitRoleNames ??
              user.resourceLimitId.roleIds,
          }}
          systemSlug={systemSlug}
          className="mt-3"
        />
      )}
    </div>
  );
}
