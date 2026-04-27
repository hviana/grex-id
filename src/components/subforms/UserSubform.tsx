"use client";

import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { useLocale } from "@/src/hooks/useLocale";
import type { SubformRef } from "@/src/components/shared/GenericList";
import EntityChannelsSubform from "@/src/components/subforms/EntityChannelsSubform";
import TenantSubform from "@/src/components/subforms/TenantSubform";
import ResourceLimitsSubform from "@/src/components/subforms/ResourceLimitsSubform";

interface UserSubformProps {
  initialData?: Record<string, unknown>;
  isCreate?: boolean;
  systemSlug?: string;
}

const UserSubform = forwardRef<SubformRef, UserSubformProps>(
  ({ initialData, isCreate = false, systemSlug }, ref) => {
    const { t } = useLocale();

    const [name, setName] = useState(
      (initialData?.profileId as { name?: string })?.name ??
        (initialData?.name as string) ??
        "",
    );
    const [password, setPassword] = useState("");

    const channelsRef = useRef<SubformRef>(null);
    const tenantRef = useRef<SubformRef>(null);
    const limitsRef = useRef<SubformRef>(null);

    useImperativeHandle(ref, () => ({
      getData: () => {
        const data: Record<string, unknown> = { name: name.trim() };
        if (isCreate) {
          const channelsData = channelsRef.current?.getData();
          if (channelsData) Object.assign(data, channelsData);
          if (password) data.password = password;
        }
        const tenantData = tenantRef.current?.getData();
        if (tenantData) Object.assign(data, tenantData);
        const limitsData = limitsRef.current?.getData();
        if (limitsData && Object.keys(limitsData).length > 0) {
          data.resourceLimits = limitsData;
        }
        return data;
      },
      isValid: () => {
        if (!name.trim()) return false;
        if (isCreate) {
          if (!channelsRef.current?.isValid()) return false;
          if (!password) return false;
        }
        if (!tenantRef.current?.isValid()) return false;
        return true;
      },
    }));

    const inputCls =
      "w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-2.5 text-white placeholder-white/30 outline-none focus:border-[var(--color-primary-green)] transition-colors";

    const limitsInitial =
      (initialData?.resourceLimitId as Record<string, unknown>) ?? undefined;

    return (
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
            {t("common.placeholder.name")} *
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("common.placeholder.name")}
            className={inputCls}
          />
        </div>

        {isCreate && (
          <>
            <EntityChannelsSubform
              ref={channelsRef}
              mode="local"
              channelTypes={["email", "phone"]}
              requiredTypes={["email"]}
            />
            <div>
              <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
                {t("common.users.password")} *
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("common.users.password")}
                className={inputCls}
              />
            </div>
          </>
        )}

        <TenantSubform
          ref={tenantRef}
          initialData={{
            roles: (initialData?.contextRoles as string[]) ??
              (initialData?.roles as string[]) ?? [],
            systemSlug,
          }}
          visibleFields={["roles"]}
          requiredFields={["roles"]}
        />

        <ResourceLimitsSubform
          ref={limitsRef}
          valueMode="absolute"
          initialData={limitsInitial}
          systemSlug={systemSlug}
        />
      </div>
    );
  },
);

UserSubform.displayName = "UserSubform";
export default UserSubform;
