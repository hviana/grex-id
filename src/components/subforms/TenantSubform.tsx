"use client";

import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import type { SubformRef } from "@/src/components/shared/GenericList";
import type { TenantActorType } from "@/src/contracts/high_level/tenant-context";
import SearchableSelectField from "@/src/components/fields/SearchableSelectField";
import MultiBadgeField from "@/src/components/fields/MultiBadgeField";
import type { BadgeValue } from "@/src/contracts/high_level/components";
import TranslatedBadge from "@/src/components/shared/TranslatedBadge";
import { useTenantContext } from "@/src/hooks/useTenantContext";
import type {
  TenantFieldName,
  TenantFormData,
} from "@/src/contracts/high_level/tenant-display";

export type {
  TenantFieldName,
  TenantFormData,
} from "@/src/contracts/high_level/tenant-display";

interface TenantSubformProps {
  initialData?: Partial<TenantFormData>;
  visibleFields?: TenantFieldName[];
  requiredFields?: TenantFieldName[];
  roleValueMode?: "id" | "name";
}

const ALL_FIELDS: TenantFieldName[] = [
  "companyId",
  "systemId",
  "systemSlug",
  "actorId",
  "actorType",
  "roles",
  "groupIds",
  "exchangeable",
  "frontendUse",
  "frontendDomains",
  "isolateSystem",
  "isolateCompany",
  "isolateUser",
];

function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <div
        className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer ${
          on ? "bg-[var(--color-primary-green)]" : "bg-white/10"
        }`}
        onClick={() => onChange(!on)}
      >
        <div
          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
            on ? "left-5" : "left-0.5"
          }`}
        />
      </div>
      <span className="text-sm text-white">{label}</span>
    </label>
  );
}

const TenantSubform = forwardRef<SubformRef, TenantSubformProps>(
  (
    {
      initialData,
      visibleFields = ALL_FIELDS,
      requiredFields = [],
      roleValueMode = "name",
    },
    ref,
  ) => {
    const { t } = useTenantContext();
    const { systemToken } = useTenantContext();

    const show = useCallback(
      (field: TenantFieldName) => visibleFields.includes(field),
      [visibleFields],
    );
    const required = useCallback(
      (field: TenantFieldName) => requiredFields.includes(field),
      [requiredFields],
    );

    const [companyId, setCompanyId] = useState<
      { id: string; label: string }[]
    >(() => {
      const v = initialData?.companyId;
      return v ? [{ id: v, label: v }] : [];
    });
    const [systemId, setSystemId] = useState<
      { id: string; label: string; slug?: string }[]
    >(() => {
      const v = initialData?.systemId;
      return v ? [{ id: v, label: v, slug: initialData?.systemSlug }] : [];
    });
    const [systemSlug, setSystemSlug] = useState(
      (initialData?.systemSlug as string) ?? "",
    );
    const [actorId, setActorId] = useState<
      { id: string; label: string }[]
    >(() => {
      const v = initialData?.actorId;
      return v ? [{ id: v, label: v }] : [];
    });
    const [actorType, setActorType] = useState<TenantActorType | "">(
      (initialData?.actorType as TenantActorType) ?? "",
    );
    const [roles, setRoles] = useState<BadgeValue[]>(() => {
      const arr = initialData?.roles;
      if (!arr) return [];
      return arr.map((r) => r);
    });
    const [groupIds, setGroupIds] = useState<BadgeValue[]>(() => {
      const arr = initialData?.groupIds;
      if (!Array.isArray(arr)) return [];
      return arr.map((entry: unknown) => {
        if (entry && typeof entry === "object") {
          return {
            id: (entry as Record<string, unknown>).id as string,
            name: (entry as Record<string, unknown>).name as string,
          };
        }
        return { id: String(entry), name: String(entry) };
      });
    });
    const [exchangeable, setExchangeable] = useState(
      initialData?.exchangeable ?? false,
    );
    const [frontendUse, setFrontendUse] = useState(
      initialData?.frontendUse ?? false,
    );
    const [frontendDomains, setFrontendDomains] = useState<BadgeValue[]>(
      () => {
        const arr = initialData?.frontendDomains;
        if (!arr) return [];
        return arr.map((d) => d);
      },
    );
    const [isolateSystem, setIsolateSystem] = useState(
      initialData?.isolateSystem ?? false,
    );
    const [isolateCompany, setIsolateCompany] = useState(
      initialData?.isolateCompany ?? false,
    );
    const [isolateUser, setIsolateUser] = useState(
      initialData?.isolateUser ?? false,
    );

    const authHeaders = useMemo(
      () =>
        systemToken
          ? { Authorization: `Bearer ${systemToken}` }
          : ({} as Record<string, string>),
      [systemToken],
    );

    const fetchCompanies = useCallback(
      async (search: string) => {
        const params = new URLSearchParams();
        if (search) params.set("search", search);
        const res = await fetch(`/api/companies?${params}`, {
          headers: authHeaders,
        });
        const json = await res.json();
        return (json.data ?? []).map(
          (c: { id: string; name: string }) => ({
            id: String(c.id),
            label: c.name,
          }),
        );
      },
      [authHeaders],
    );

    const fetchSystems = useCallback(
      async (search: string) => {
        const params = new URLSearchParams();
        if (search) params.set("search", search);
        const currentCompanyId = companyId.length > 0
          ? companyId[0].id
          : undefined;
        if (currentCompanyId) params.set("companyId", currentCompanyId);
        const res = await fetch(`/api/core/systems?${params}`, {
          headers: authHeaders,
        });
        const json = await res.json();
        return (json.data ?? []).map(
          (s: { id: string; name: string; slug: string }) => ({
            id: String(s.id),
            label: s.name,
            slug: s.slug,
          }),
        );
      },
      [authHeaders, companyId],
    );

    const fetchUsers = useCallback(
      async (search: string) => {
        const params = new URLSearchParams();
        if (search) params.set("search", search);
        const res = await fetch(`/api/users?${params}`, {
          headers: authHeaders,
        });
        const json = await res.json();
        return (json.data ?? []).map(
          (u: { id: string; profileId?: { name: string } | string }) => ({
            id: String(u.id),
            label: typeof u.profileId === "object" && u.profileId?.name
              ? u.profileId.name
              : String(u.id),
          }),
        );
      },
      [authHeaders],
    );

    const fetchRoles = useCallback(
      async (search: string): Promise<BadgeValue[]> => {
        const params = new URLSearchParams();
        if (search) params.set("search", search);
        const currentSystemId = systemId.length > 0
          ? systemId[0].id
          : undefined;
        if (currentSystemId) params.set("systemId", currentSystemId);
        const res = await fetch(`/api/core/roles?${params}`, {
          headers: authHeaders,
        });
        const json = await res.json();
        return (json.data ?? []).map(
          (r: { id: string; name: string }) => ({
            id: String(r.id),
            name: r.name,
          }),
        );
      },
      [authHeaders, systemId],
    );

    const fetchGroups = useCallback(
      async (search: string): Promise<BadgeValue[]> => {
        const params = new URLSearchParams();
        if (search) params.set("search", search);
        params.set("limit", "50");
        const res = await fetch(`/api/groups?${params}`, {
          headers: authHeaders,
        });
        const json = await res.json();
        return ((json.items ?? json.data ?? []) as Record<string, unknown>[])
          .map(
            (g) => ({
              id: String(g.id),
              name: String(g.name ?? ""),
            }),
          );
      },
      [authHeaders],
    );

    useImperativeHandle(ref, () => ({
      getData: () => {
        const data: Record<string, unknown> = {};
        if (show("companyId")) {
          data.companyId = companyId.length > 0 ? companyId[0].id : "";
        }
        if (show("systemId")) {
          data.systemId = systemId.length > 0 ? systemId[0].id : "";
        }
        if (show("systemSlug")) {
          data.systemSlug = systemSlug;
        }
        if (show("actorId")) {
          data.actorId = actorId.length > 0 ? actorId[0].id : "";
        }
        if (show("actorType")) {
          data.actorType = actorType || undefined;
        }
        if (show("roles")) {
          data.roles = roles.map((r) =>
            typeof r === "string" ? r : roleValueMode === "id" ? r.id : r.name
          );
        }
        if (show("groupIds")) {
          data.groupIds = groupIds.map((g) => typeof g === "string" ? g : g.id);
        }
        if (show("exchangeable")) {
          data.exchangeable = exchangeable;
        }
        if (show("frontendUse")) {
          data.frontendUse = frontendUse;
        }
        if (show("frontendDomains")) {
          data.frontendDomains = frontendDomains.map((d) =>
            typeof d === "string" ? d : d.name
          );
        }
        if (show("isolateSystem")) data.isolateSystem = isolateSystem;
        if (show("isolateCompany")) data.isolateCompany = isolateCompany;
        if (show("isolateUser")) data.isolateUser = isolateUser;
        return data;
      },
      isValid: () => {
        if (
          show("companyId") && required("companyId") && companyId.length === 0
        ) {
          return false;
        }
        if (show("systemId") && required("systemId") && systemId.length === 0) {
          return false;
        }
        if (
          show("systemSlug") && required("systemSlug") && !systemSlug.trim()
        ) {
          return false;
        }
        if (show("actorId") && required("actorId") && actorId.length === 0) {
          return false;
        }
        if (show("actorType") && required("actorType") && !actorType) {
          return false;
        }
        if (
          show("roles") && required("roles") && roles.length === 0
        ) {
          return false;
        }
        if (
          show("frontendDomains") && required("frontendDomains") &&
          frontendDomains.length === 0
        ) {
          return false;
        }
        return true;
      },
    }));

    const inputCls =
      "w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-2.5 text-white placeholder-white/30 outline-none focus:border-[var(--color-primary-green)] transition-colors";

    return (
      <div className="space-y-4">
        {show("companyId") && (
          <div>
            <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
              {t("core.tenant.companyId")}
              {required("companyId") ? " *" : ""}
            </label>
            <SearchableSelectField
              fetchFn={fetchCompanies}
              placeholder={t("core.tenant.placeholder.companyId")}
              initialSelected={companyId}
              onChange={(sel) => setCompanyId(sel)}
            />
          </div>
        )}

        {show("systemId") && (
          <div>
            <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
              {t("core.tenant.systemId")}
              {required("systemId") ? " *" : ""}
            </label>
            <SearchableSelectField
              fetchFn={fetchSystems}
              placeholder={t("core.tenant.placeholder.systemId")}
              initialSelected={systemId.map((s) => ({
                id: s.id,
                label: s.label,
              }))}
              onChange={(sel) => {
                setSystemId(
                  sel.map((s) => ({
                    id: s.id,
                    label: s.label,
                    slug: (s as { slug?: string }).slug,
                  })),
                );
                if (sel.length > 0) {
                  const selSlug = (sel[0] as { slug?: string }).slug;
                  if (selSlug) setSystemSlug(selSlug);
                }
              }}
            />
          </div>
        )}

        {show("systemSlug") && (
          <div>
            <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
              {t("core.tenant.systemSlug")}
              {required("systemSlug") ? " *" : ""}
            </label>
            <input
              type="text"
              value={systemSlug}
              onChange={(e) => setSystemSlug(e.target.value)}
              placeholder={t("core.tenant.placeholder.systemSlug")}
              className={inputCls}
            />
          </div>
        )}

        {show("actorId") && (
          <div>
            <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
              {t("core.tenant.actorId")}
              {required("actorId") ? " *" : ""}
            </label>
            <SearchableSelectField
              fetchFn={fetchUsers}
              placeholder={t("core.tenant.placeholder.actorId")}
              initialSelected={actorId}
              onChange={(sel) => setActorId(sel)}
            />
          </div>
        )}

        {show("actorType") && (
          <div>
            <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
              {t("core.tenant.actorType")}
              {required("actorType") ? " *" : ""}
            </label>
            <select
              value={actorType}
              onChange={(e) =>
                setActorType(e.target.value as TenantActorType | "")}
              className={inputCls}
            >
              <option value="">{t("core.tenant.placeholder.actorType")}</option>
              <option value="user">{t("core.tenant.actorTypeUser")}</option>
              <option value="api_token">
                {t("core.tenant.actorTypeApiToken")}
              </option>
              <option value="app">
                {t("core.tenant.actorTypeApp")}
              </option>
            </select>
          </div>
        )}

        {show("roles") && (
          <div>
            <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
              {t("core.tenant.roles")}
              {required("roles") ? " *" : ""}
            </label>
            <MultiBadgeField
              name={t("core.tenant.roles")}
              mode="search"
              value={roles}
              onChange={setRoles}
              fetchFn={fetchRoles}
              formatHint={t("core.tenant.rolesHint")}
              renderBadge={(item, remove) => (
                <TranslatedBadge
                  kind="role"
                  token={typeof item === "string" ? item : item.name}
                  systemSlug={systemSlug || undefined}
                  onRemove={remove}
                />
              )}
            />
          </div>
        )}

        {show("groupIds") && (
          <div>
            <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
              {t("common.groups.entity")}
            </label>
            <MultiBadgeField
              name={t("common.groups.entity")}
              mode="search"
              value={groupIds}
              onChange={setGroupIds}
              fetchFn={fetchGroups}
            />
          </div>
        )}

        {show("exchangeable") && (
          <Toggle
            on={exchangeable}
            onChange={setExchangeable}
            label={t("core.tenant.exchangeable")}
          />
        )}

        {show("frontendUse") && (
          <Toggle
            on={frontendUse}
            onChange={setFrontendUse}
            label={t("core.tenant.frontendUse")}
          />
        )}

        {show("frontendDomains") && frontendUse && (
          <div>
            <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
              {t("core.tenant.frontendDomains")}
              {required("frontendDomains") ? " *" : ""}
            </label>
            <MultiBadgeField
              name={t("core.tenant.frontendDomains")}
              mode="custom"
              value={frontendDomains}
              onChange={setFrontendDomains}
              formatHint={t("core.tenant.frontendDomainsHint")}
            />
          </div>
        )}

        {(show("isolateSystem") ||
          show("isolateCompany") ||
          show("isolateUser")) && (
          <div className="p-4 rounded-lg border border-[var(--color-dark-gray)] bg-white/[0.02] space-y-3">
            <h3 className="text-sm font-semibold text-[var(--color-light-text)] uppercase tracking-wider">
              {t("core.tenant.isolation")}
            </h3>
            <div className="flex flex-wrap gap-4">
              {show("isolateSystem") && (
                <Toggle
                  on={isolateSystem}
                  onChange={setIsolateSystem}
                  label={t("core.tenant.isolateSystem")}
                />
              )}
              {show("isolateCompany") && (
                <Toggle
                  on={isolateCompany}
                  onChange={setIsolateCompany}
                  label={t("core.tenant.isolateCompany")}
                />
              )}
              {show("isolateUser") && (
                <Toggle
                  on={isolateUser}
                  onChange={setIsolateUser}
                  label={t("core.tenant.isolateUser")}
                />
              )}
            </div>
          </div>
        )}
      </div>
    );
  },
);

TenantSubform.displayName = "TenantSubform";
export default TenantSubform;
