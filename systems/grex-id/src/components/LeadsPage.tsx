"use client";

import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import GenericList from "@/src/components/shared/GenericList";
import type {
  SubformConfig,
  SubformRef,
} from "@/src/contracts/high-level/components";
import LeadCoreSubform from "@/src/components/subforms/LeadCoreSubform";
import FacialBiometricsSubform from "./FacialBiometricsSubform.tsx";
import SearchableSelectField from "@/src/components/fields/SearchableSelectField";
import type {
  CursorParams,
  PaginatedResult,
} from "@/src/contracts/high-level/pagination";
import type { FilterValues } from "@/src/contracts/high-level/components";
import { useTenantContext } from "@/src/hooks/useTenantContext";
import type { OwnerSubformProps } from "@/systems/grex-id/src/contracts/high-level/component-props";

const OwnerSubform = forwardRef<SubformRef, OwnerSubformProps>(
  ({ initialData }, ref) => {
    const { t } = useTenantContext();
    const { systemToken } = useTenantContext();
    const { companyId, systemId } = useTenantContext();
    const [selected, setSelected] = useState<{ id: string; label: string }[]>(
      () => {
        if (initialData?.ownerId && initialData?.ownerName) {
          return [{
            id: initialData.ownerId as string,
            label: initialData.ownerName as string,
          }];
        }
        return [];
      },
    );

    const fetchOwners = useCallback(async (search: string) => {
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
      return json.data ?? [];
    }, [systemToken, companyId, systemId]);

    useImperativeHandle(ref, () => ({
      getData: () => ({
        ownerId: selected[0]?.id ?? undefined,
      }),
      isValid: () => true,
    }));

    return (
      <div>
        <h3 className="text-sm font-semibold text-[var(--color-secondary-blue)] mb-3 flex items-center gap-2">
          <span>👑</span> {t("systems.grex-id.lead.owner")}
        </h3>
        <SearchableSelectField
          fetchFn={fetchOwners}
          multiple={false}
          onChange={setSelected}
          initialSelected={selected}
        />
      </div>
    );
  },
);
OwnerSubform.displayName = "OwnerSubform";

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
      params: CursorParams & { search?: string; filters?: FilterValues },
    ): Promise<PaginatedResult<Record<string, unknown>>> => {
      if (!systemToken || !companyId || !systemId) {
        return { items: [], total: 0, hasMore: false };
      }

      const qs = new URLSearchParams();
      if (params.limit) qs.set("limit", String(params.limit));
      if (params.cursor) qs.set("cursor", String(params.cursor));
      if (params.search) qs.set("search", String(params.search));
      if (params.filters) {
        for (const [key, value] of Object.entries(params.filters)) {
          if (value) qs.set(key, String(value));
        }
      }
      qs.set("companyId", companyId);
      qs.set("systemId", systemId);

      const res = await fetch(`/api/leads?${qs.toString()}`, {
        headers: { Authorization: `Bearer ${systemToken}` },
      });
      const json = await res.json();
      return {
        items: (json.items ?? []) as Record<string, unknown>[],
        total: json.total ?? 0,
        hasMore: json.hasMore ?? false,
        nextCursor: json.nextCursor ?? undefined,
      };
    },
    [systemToken, companyId, systemId],
  );

  const renderLeadItem = (
    item: Record<string, unknown>,
    controls: React.ReactNode,
  ) => {
    const profile =
      (typeof item.profileId === "object" ? item.profileId : null) as
        | { name?: string; avatarUri?: string; dateOfBirth?: string }
        | null;
    const avatarUri = profile?.avatarUri || (item.avatarUri as string) || null;
    const channels =
      (Array.isArray(item.channelIds) ? item.channelIds : []) as {
        type: string;
        value: string;
      }[];
    const primaryChannel = channels.find((c) => c.type === "email") ??
      channels[0];
    const secondaryChannels = channels.filter((c) => c !== primaryChannel);
    const tags = (Array.isArray(item.tagIds) ? item.tagIds : []) as {
      id: string;
      name: string;
      color?: string;
    }[];

    return (
      <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-4 hover:-translate-y-1 hover:shadow-lg hover:shadow-[var(--color-light-green)]/20 transition-all duration-300">
        <div className="flex items-center gap-4">
          <div className="flex-shrink-0">
            {avatarUri
              ? (
                <img
                  src={`/api/files/download?uri=${
                    encodeURIComponent(avatarUri)
                  }`}
                  alt=""
                  className="w-12 h-12 rounded-full object-cover border-2 border-[var(--color-primary-green)]/30"
                />
              )
              : (
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[var(--color-primary-green)]/20 to-[var(--color-secondary-blue)]/20 flex items-center justify-center text-xl border border-[var(--color-dark-gray)]">
                  👤
                </div>
              )}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-white font-semibold text-sm truncate">
              {item.name as string}
            </h3>
            {primaryChannel && (
              <p className="text-[var(--color-light-text)] text-xs truncate">
                {primaryChannel.value}
              </p>
            )}
            {secondaryChannels.map((c) => (
              <p
                key={c.value}
                className="text-[var(--color-light-text)] text-xs"
              >
                {c.value}
              </p>
            ))}
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {tags.map((tag) => (
                  <span
                    key={tag.id}
                    className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] border"
                    style={tag.color
                      ? {
                        backgroundColor: `${tag.color}20`,
                        borderColor: `${tag.color}50`,
                        color: tag.color,
                      }
                      : undefined}
                  >
                    {tag.name}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">{controls}</div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <span className="text-2xl">🧑‍🤝‍🧑</span>
        <h1 className="text-2xl font-bold bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent">
          {t("systems.grex-id.leads.title")}
        </h1>
      </div>

      <GenericList
        entityName={t("systems.grex-id.leads.entity")}
        createEnabled={Boolean(companyId && systemId)}
        fetchFn={fetchLeads}
        formSubforms={subforms}
        createRoute="/api/systems/grex-id/leads"
        editRoute={(id) => `/api/systems/grex-id/leads?id=${id}`}
        deleteRoute={(id) =>
          `/api/leads?id=${id}&companyId=${companyId}&systemId=${systemId}`}
        fetchOneRoute={(id) => `/api/leads?action=get-one&id=${id}`}
        renderItem={renderLeadItem}
        authToken={systemToken}
        extraData={{
          companyId: companyId ?? "",
          systemId: systemId ?? "",
        }}
      />
    </div>
  );
}
