"use client";

import type { ReactNode } from "react";
import { useTenantContext } from "@/src/hooks/useTenantContext";
import ChannelActions from "@/src/components/shared/ChannelActions";
import TranslatedBadgeList from "@/src/components/shared/TranslatedBadgeList";
import type { LeadViewProps } from "@/src/contracts/high-level/component-props";

function ensureChannelArray(
  channelIds: unknown,
): { id: string; type: string; value: string; verified: boolean }[] {
  return Array.isArray(channelIds) ? channelIds : [];
}

export default function LeadView(
  { lead, systemSlug, customActions }: LeadViewProps,
) {
  const { t } = useTenantContext();

  const displayName = lead.profileId?.name || lead.name ||
    t("common.lead.unknown");
  const avatarUri = lead.profileId?.avatarUri;
  const channels = ensureChannelArray(lead.channelIds);
  const tagNames = lead.tagIds?.filter(Boolean) ?? [];
  const ownerNames = lead.ownerIds?.map((o) => o.name).filter(Boolean) ?? [];

  return (
    <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-4 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-[var(--color-light-green)]/10 transition-all duration-200">
      {/* Header: Avatar + Name + ID + communication warning */}
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-full bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] flex items-center justify-center text-black font-bold text-lg shrink-0">
          {avatarUri
            ? (
              <img
                src={`/api/files/download?uri=${encodeURIComponent(avatarUri)}`}
                alt={displayName}
                className="w-full h-full rounded-full object-cover"
              />
            )
            : <span role="img" aria-label="lead avatar">👤</span>}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-white truncate">
              {displayName}
            </h3>

            {lead.id && (
              <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs border border-[var(--color-dark-gray)] bg-white/5 text-[var(--color-light-text)] shrink-0">
                ID: {lead.id}
              </span>
            )}

            {lead.interactions !== undefined && (
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs border border-[var(--color-secondary-blue)]/30 bg-[var(--color-secondary-blue)]/10 text-[var(--color-secondary-blue)] shrink-0">
                🔎 {lead.interactions}
              </span>
            )}

            {!lead.acceptsCommunication && (
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs border border-yellow-500/30 bg-yellow-500/10 text-yellow-400 shrink-0">
                ⚠ {t("common.lead.noCommunication")}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Tags */}
      {tagNames.length > 0 && (
        <div className="mt-4">
          <TranslatedBadgeList
            kind="entity"
            tokens={tagNames}
            systemSlug={systemSlug}
            title={t("common.lead.tags")}
            emptyText={undefined}
          />
        </div>
      )}

      {/* Owners */}
      {ownerNames.length > 0 && (
        <div className="mt-3">
          <TranslatedBadgeList
            kind="entity"
            tokens={ownerNames}
            systemSlug={systemSlug}
            title={t("common.lead.owners")}
            emptyText={undefined}
          />
        </div>
      )}

      {/* Channels */}
      {channels.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-light-text)] mb-1">
            {t("common.lead.channels")}
          </p>
          <ChannelActions
            channels={channels.map((ch) => ({
              type: ch.type,
              value: ch.value,
            }))}
            actions={["whatsapp", "email"]}
          />
        </div>
      )}

      {/* Custom actions */}
      {customActions && (
        <div className="mt-4 flex flex-wrap gap-2">
          {customActions}
        </div>
      )}
    </div>
  );
}
