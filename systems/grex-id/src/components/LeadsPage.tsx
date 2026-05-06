"use client";

import { useCallback, useMemo } from "react";
import GenericList from "@/src/components/shared/GenericList";
import LeadView from "@/src/components/shared/LeadView";
import MultiBadgeFieldFilter from "@/src/components/filters/MultiBadgeFieldFilter";
import TextFilter from "@/src/components/filters/TextFilter";
import OwnerSubform from "@/src/components/subforms/OwnerSubform";
import type { SubformConfig } from "@/src/contracts/high-level/components";
import type { BadgeValue } from "@/src/contracts/high-level/components";
import type { LeadViewData } from "@/src/contracts/high-level/lead";
import LeadCoreSubform from "@/src/components/subforms/LeadCoreSubform";
import FacialBiometricsSubform from "./FacialBiometricsSubform.tsx";
import type {
  CursorParams,
  PaginatedResult,
} from "@/src/contracts/high-level/pagination";
import { useTenantContext } from "@/src/hooks/useTenantContext";

function useLeadSubforms(): SubformConfig[] {
  const { systemToken } = useTenantContext();
  const { companyId, systemId, systemSlug } = useTenantContext();

  const safeCompanyId = companyId ?? "";
  const safeSystemId = systemId ?? "";
  const safeSystemSlug = systemSlug ?? "";

  return useMemo(() => [
    {
      component: LeadCoreSubform as SubformConfig["component"],
      key: "leadCore",
      extraProps: {
        companyId: safeCompanyId,
        systemId: safeSystemId,
        systemSlug: safeSystemSlug,
      },
    },
    {
      component: FacialBiometricsSubform as SubformConfig["component"],
      key: "facialBiometrics",
      extraProps: {
        companyId: safeCompanyId,
        systemSlug: safeSystemSlug,
        systemToken,
      },
    },
    {
      component: OwnerSubform as SubformConfig["component"],
      key: "owner",
    },
  ], [safeCompanyId, safeSystemId, safeSystemSlug, systemToken]);
}

export default function LeadsPage() {
  const { t } = useTenantContext();
  const { systemToken } = useTenantContext();
  const { companyId, systemId } = useTenantContext();
  const subforms = useLeadSubforms();

  const fetchLeads = useCallback(
    async (
      params: CursorParams & {
        search?: string;
        filters?: Record<string, unknown>;
      },
    ): Promise<PaginatedResult<LeadViewData>> => {
      if (!systemToken || !companyId || !systemId) {
        return { items: [], total: 0, hasMore: false };
      }

      const qs = new URLSearchParams();
      if (params.limit) qs.set("limit", String(params.limit));
      if (params.cursor) qs.set("cursor", String(params.cursor));
      if (params.filters?.search) {
        qs.set("search", String(params.filters.search as string));
      }
      if (params.filters?.tags) {
        const tagIds = (params.filters.tags as BadgeValue[])
          .map((b) => typeof b === "string" ? b : b.id ?? b.name)
          .filter(Boolean);
        if (tagIds.length > 0) qs.set("tagIds", tagIds.join(","));
      }
      qs.set("companyId", companyId);
      qs.set("systemId", systemId);

      const res = await fetch(`/api/leads?${qs.toString()}`, {
        headers: { Authorization: `Bearer ${systemToken}` },
      });
      const json = await res.json();
      return {
        items: (json.items ?? []) as LeadViewData[],
        total: json.total ?? 0,
        hasMore: json.hasMore ?? false,
        nextCursor: json.nextCursor ?? undefined,
      };
    },
    [systemToken, companyId, systemId],
  );

  const fetchTags = useCallback(
    async (search: string): Promise<BadgeValue[]> => {
      if (!systemToken) return [];
      const qs = new URLSearchParams();
      if (search) qs.set("search", search);
      qs.set("limit", "20");
      const res = await fetch(`/api/tags?${qs.toString()}`, {
        headers: { Authorization: `Bearer ${systemToken}` },
      });
      const json = await res.json();
      return ((json.items ?? []) as { id: string; name: string }[]).map(
        (t) => ({ id: t.id, name: t.name }),
      );
    },
    [systemToken],
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <span className="text-2xl">🧑‍🤝‍🧑</span>
        <h1 className="text-2xl font-bold bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent">
          {t("systems.grex-id.leads.title")}
        </h1>
      </div>

      <GenericList<LeadViewData>
        entityName={t("systems.grex-id.leads.entity")}
        searchEnabled={false}
        createEnabled={Boolean(companyId && systemId)}
        filters={[
          {
            key: "search",
            label: t("common.search"),
            component: TextFilter,
            props: { placeholder: t("common.search") },
          },
          {
            key: "tags",
            label: "",
            component: MultiBadgeFieldFilter,
            props: {
              name: t("common.tags"),
              fetchFn: fetchTags,
            },
          },
        ]}
        fetchFn={fetchLeads}
        formSubforms={subforms}
        createRoute="/api/systems/grex-id/leads"
        editRoute={(id) => `/api/systems/grex-id/leads?id=${id}`}
        deleteRoute={(id) =>
          `/api/leads?id=${id}&companyId=${companyId}&systemId=${systemId}`}
        fetchOneRoute={(id) => `/api/leads?action=get-one&id=${id}`}
        renderItem={(lead, controls) => (
          <LeadView
            lead={lead}
            systemSlug="grex-id"
            customActions={controls}
          />
        )}
        authToken={systemToken}
        extraData={{
          companyId: companyId ?? "",
          systemId: systemId ?? "",
        }}
      />
    </div>
  );
}
