"use client";

import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { SubformRef } from "@/src/contracts/high_level/components";
import EntityChannelsSubform from "./EntityChannelsSubform.tsx";
import ProfileSubform from "./ProfileSubform.tsx";
import MultiBadgeField from "@/src/components/fields/MultiBadgeField";
import type { BadgeValue } from "@/src/contracts/high_level/components";
import type { EntityChannel } from "@/src/contracts/entity-channel";
import { useTenantContext } from "@/src/hooks/useTenantContext";

interface LeadCoreSubformProps {
  initialData?: Record<string, unknown>;
  hideTags?: boolean;
  companyId?: string;
  systemId?: string;
  systemSlug?: string;
}

const LeadCoreSubform = forwardRef<SubformRef, LeadCoreSubformProps>(
  ({ initialData, hideTags, companyId, systemId, systemSlug }, ref) => {
    const { t } = useTenantContext();
    const { systemToken } = useTenantContext();
    const channelsRef = useRef<SubformRef>(null);
    const profileRef = useRef<SubformRef>(null);

    // Seed entity channels from the existing lead (if any). `initialData` may
    // carry a hydrated `channels` array (from the leads API FETCH) — pass it
    // through as-is so the subform can prefill in `local` mode.
    const initialChannels: Record<string, unknown> = {
      channels: Array.isArray(
          (initialData as { channelIds?: unknown })?.channelIds,
        )
        ? ((initialData as { channelIds?: EntityChannel[] }).channelIds ?? [])
        : [],
    };

    const [tags, setTags] = useState<BadgeValue[]>(() => {
      const initial = initialData?.tagIds;
      if (Array.isArray(initial)) {
        return initial.map((
          tag: { id: string; name: string; color?: string },
        ) => ({
          id: tag.id,
          name: tag.name,
          color: tag.color,
        }));
      }
      return [];
    });

    const fetchTags = useCallback(
      async (search: string): Promise<BadgeValue[]> => {
        const headers: HeadersInit = {};
        if (systemToken) {
          headers["Authorization"] = `Bearer ${systemToken}`;
        }
        const res = await fetch(
          `/api/tags?search=${encodeURIComponent(search)}`,
          { headers },
        );
        const json = await res.json();
        return (json.data ?? []).map((
          tag: { id: string; name: string; color: string },
        ) => ({
          id: tag.id,
          name: tag.name,
          color: tag.color,
        }));
      },
      [systemToken],
    );

    useImperativeHandle(ref, () => ({
      getData: () => {
        const channelsData = channelsRef.current?.getData() ?? {};
        const profileData = profileRef.current?.getData() ?? {};
        const profile =
          (profileData as { profile?: { name?: string } }).profile;
        const tagIds = tags.map((tag) =>
          typeof tag === "string" ? tag : tag.id ?? tag.name
        );
        return {
          name: profile?.name ?? "",
          ...channelsData,
          ...profileData,
          tags: tagIds,
          companyId,
          systemId,
        };
      },
      isValid: () => {
        return (
          (channelsRef.current?.isValid() ?? false) &&
          (profileRef.current?.isValid() ?? false)
        );
      },
    }));

    return (
      <div className="space-y-5">
        <div>
          <h3 className="text-sm font-semibold text-[var(--color-secondary-blue)] mb-3 flex items-center gap-2">
            <span>📞</span> {t("systems.grex-id.lead.contact")}
          </h3>
          <EntityChannelsSubform
            ref={channelsRef}
            mode="local"
            channelTypes={["email", "phone"]}
            requiredTypes={["email"]}
            initialData={initialChannels}
          />
        </div>

        <div>
          <h3 className="text-sm font-semibold text-[var(--color-secondary-blue)] mb-3 flex items-center gap-2">
            <span>👤</span> {t("systems.grex-id.lead.profile")}
          </h3>
          <ProfileSubform
            ref={profileRef}
            initialData={initialData}
            companyId={companyId}
            systemSlug={systemSlug}
            hideAvatar
          />
        </div>

        {!hideTags && (
          <div>
            <h3 className="text-sm font-semibold text-[var(--color-secondary-blue)] mb-3 flex items-center gap-2">
              <span>🏷️</span> {t("systems.grex-id.lead.tags")}
            </h3>
            <MultiBadgeField
              name={t("systems.grex-id.lead.tags")}
              mode="custom"
              value={tags}
              onChange={setTags}
              fetchFn={fetchTags}
            />
          </div>
        )}
      </div>
    );
  },
);

LeadCoreSubform.displayName = "LeadCoreSubform";
export default LeadCoreSubform;
