"use client";

import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { useLocale } from "@/src/hooks/useLocale";
import { useAuth } from "@/src/hooks/useAuth";
import type { SubformRef } from "@/src/components/shared/GenericList";
import ContactSubform from "./ContactSubform";
import ProfileSubform from "./ProfileSubform";
import MultiBadgeField from "@/src/components/fields/MultiBadgeField";
import type { BadgeValue } from "@/src/components/fields/MultiBadgeField";

interface LeadCoreSubformProps {
  initialData?: Record<string, unknown>;
  hideTags?: boolean;
  companyId?: string;
  systemId?: string;
  systemSlug?: string;
  userId?: string;
}

const LeadCoreSubform = forwardRef<SubformRef, LeadCoreSubformProps>(
  ({ initialData, hideTags, companyId, systemId, systemSlug, userId }, ref) => {
    const { t } = useLocale();
    const { systemToken } = useAuth();
    const contactRef = useRef<SubformRef>(null);
    const profileRef = useRef<SubformRef>(null);

    const [tags, setTags] = useState<BadgeValue[]>(() => {
      const initial = initialData?.tags;
      if (Array.isArray(initial)) {
        return initial.map((
          tag: { id: string; name: string; color?: string },
        ) => ({
          name: tag.name,
          color: tag.color,
          id: tag.id,
        })) as BadgeValue[];
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
          name: tag.name,
          color: tag.color,
        }));
      },
      [systemToken],
    );

    useImperativeHandle(ref, () => ({
      getData: () => {
        const contactData = contactRef.current?.getData() ?? {};
        const profileData = profileRef.current?.getData() ?? {};
        const profile =
          (profileData as { profile?: { name?: string } }).profile;
        const tagIds = tags.map((tag) => {
          if (typeof tag === "object" && "id" in tag) {
            return (tag as { id: string }).id;
          }
          return typeof tag === "string" ? tag : tag.name;
        });
        return {
          name: profile?.name ?? "",
          ...contactData,
          ...profileData,
          tags: tagIds,
          companyId,
          systemId,
        };
      },
      isValid: () => {
        return (
          (contactRef.current?.isValid() ?? false) &&
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
          <ContactSubform ref={contactRef} initialData={initialData} />
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
            userId={userId}
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
