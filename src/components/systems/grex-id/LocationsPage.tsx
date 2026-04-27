"use client";

import { useCallback } from "react";
import GenericList from "@/src/components/shared/GenericList";
import type { SubformConfig } from "@/src/components/shared/GenericList";
import NameDescSubform from "@/src/components/subforms/NameDescSubform";
import AddressSubform from "@/src/components/subforms/AddressSubform";
import type { CursorParams, PaginatedResult } from "@/src/contracts/common";
import type { FilterValues } from "@/src/components/shared/FilterDropdown";
import { useTenantContext } from "@/src/hooks/useTenantContext";

const subforms: SubformConfig[] = [
  { component: NameDescSubform as SubformConfig["component"], key: "nameDesc" },
  {
    component:
      ((props: Record<string, unknown>) => (
        <AddressSubform {...props} fieldPrefix="address" />
      )) as unknown as SubformConfig["component"],
    key: "address",
  },
];

export default function LocationsPage() {
  const { t } = useTenantContext();
  const { systemToken } = useTenantContext();
  const { companyId, systemId } = useTenantContext();

  const fetchLocations = useCallback(
    async (
      params: CursorParams & { search?: string; filters?: FilterValues },
    ): Promise<PaginatedResult<Record<string, unknown>>> => {
      const qs = new URLSearchParams();
      if (params.limit) qs.set("limit", String(params.limit));
      if (params.cursor) qs.set("cursor", String(params.cursor));
      if (params.search) qs.set("search", String(params.search));

      const headers: HeadersInit = {};
      if (systemToken) {
        headers["Authorization"] = `Bearer ${systemToken}`;
      }

      const res = await fetch(
        `/api/systems/grex-id/locations?${qs.toString()}`,
        { headers },
      );
      const json = await res.json();
      return {
        items: (json.items ?? []) as Record<string, unknown>[],
        total: json.total ?? 0,
        hasMore: json.hasMore ?? false,
        nextCursor: json.nextCursor,
      };
    },
    [systemToken],
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <span className="text-2xl">📍</span>
        <h1 className="text-2xl font-bold bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent">
          {t("systems.grex-id.locations.title")}
        </h1>
      </div>

      <GenericList
        entityName={t("systems.grex-id.locations.entity")}
        fetchFn={fetchLocations}
        formSubforms={subforms}
        createRoute="/api/systems/grex-id/locations"
        editRoute={(id) => `/api/systems/grex-id/locations?id=${id}`}
        deleteRoute={(id) => `/api/systems/grex-id/locations?id=${id}`}
        fetchOneRoute={(id) =>
          `/api/systems/grex-id/locations?action=get-one&id=${id}`}
        fieldMap={{
          name: "string",
          description: "string",
          "address.city": "string",
          "address.state": "string",
        }}
        authToken={systemToken}
      />
    </div>
  );
}
