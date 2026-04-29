"use client";

import { useCallback } from "react";
import GenericList from "@/src/components/shared/GenericList";
import type { SubformConfig } from "@/src/contracts/high-level/components";
import NameDescSubform from "@/src/components/subforms/NameDescSubform";
import type {
  CursorParams,
  PaginatedResult,
} from "@/src/contracts/high-level/pagination";
import type { FilterValues } from "@/src/contracts/high-level/components";
import { useTenantContext } from "@/src/hooks/useTenantContext";

const subforms: SubformConfig[] = [
  { component: NameDescSubform as SubformConfig["component"], key: "nameDesc" },
];

export default function GroupsPage() {
  const { t } = useTenantContext();
  const { systemToken } = useTenantContext();

  const fetchGroups = useCallback(
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

      const res = await fetch(`/api/groups?${qs.toString()}`, { headers });
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
        <span className="text-2xl">👥</span>
        <h1 className="text-2xl font-bold bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent">
          {t("common.menu.groups")}
        </h1>
      </div>

      <GenericList
        entityName={t("common.groups.entity")}
        fetchFn={fetchGroups}
        formSubforms={subforms}
        createRoute="/api/groups"
        editRoute={(id) => `/api/groups?id=${id}`}
        deleteRoute={(id) => `/api/groups?id=${id}`}
        fetchOneRoute={(id) => `/api/groups?action=get-one&id=${id}`}
        fieldMap={{
          name: "string",
          description: "string",
        }}
        authToken={systemToken}
      />
    </div>
  );
}
