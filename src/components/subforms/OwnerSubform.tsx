"use client";

import { forwardRef, useCallback, useImperativeHandle, useState } from "react";
import type { SubformRef } from "@/src/contracts/high-level/components";
import type { BadgeValue } from "@/src/contracts/high-level/components";
import type { OwnerSubformProps } from "@/src/contracts/high-level/component-props";
import MultiBadgeField from "@/src/components/fields/MultiBadgeField";
import { useTenantContext } from "@/src/hooks/useTenantContext";

const OwnerSubform = forwardRef<SubformRef, OwnerSubformProps>(
  ({ initialData }, ref) => {
    const { t } = useTenantContext();
    const { systemToken } = useTenantContext();
    const { companyId, systemId } = useTenantContext();
    const [owners, setOwners] = useState<BadgeValue[]>(() => {
      const initial = initialData?.ownerIds;
      if (Array.isArray(initial)) {
        const result: BadgeValue[] = [];
        for (const owner of initial) {
          if (typeof owner === "string") {
            result.push({ id: owner, name: owner });
          } else if (owner && typeof owner === "object") {
            const o = owner as Record<string, unknown>;
            result.push({
              id: o.id as string,
              name: (o.name as string) ?? (o.id as string),
            });
          }
        }
        return result;
      }
      return [];
    });

    const fetchOwners = useCallback(
      async (search: string): Promise<BadgeValue[]> => {
        if (!systemToken || !companyId || !systemId) return [];
        const qs = new URLSearchParams({
          action: "search-owners",
          q: search,
          companyId,
          systemId,
        });
        const res = await fetch(`/api/leads?${qs.toString()}`, {
          headers: { Authorization: `Bearer ${systemToken}` },
        });
        const json = await res.json();
        return (json.data ?? []).map(
          (user: { id: string; name: string }) => ({
            id: user.id,
            name: user.name,
          }),
        );
      },
      [systemToken, companyId, systemId],
    );

    useImperativeHandle(ref, () => ({
      getData: () => ({
        ownerIds: owners.map((o) => typeof o === "string" ? o : o.id ?? o.name),
      }),
      isValid: () => true,
    }));

    return (
      <div>
        <h3 className="text-sm font-semibold text-[var(--color-secondary-blue)] mb-3 flex items-center gap-2">
          <span>👑</span> {t("systems.grex-id.lead.owners")}
        </h3>
        <MultiBadgeField
          name={t("systems.grex-id.lead.owners")}
          mode="search"
          value={owners}
          onChange={setOwners}
          fetchFn={fetchOwners}
          hideLabel
        />
      </div>
    );
  },
);
OwnerSubform.displayName = "OwnerSubform";

export default OwnerSubform;
