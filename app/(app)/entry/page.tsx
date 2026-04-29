"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Spinner from "@/src/components/shared/Spinner";
import { useTenantContext } from "@/src/hooks/useTenantContext";
import { getCookie, setCookie } from "@/src/lib/cookies";
import type { DefaultMenuItem } from "@/src/contracts/high-level/menu-item";

const COMPANY_COOKIE = "core_company";
const SYSTEM_COOKIE = "core_system";

function getDefaultMenus(): DefaultMenuItem[] {
  return [
    {
      id: "_default_usage",
      componentName: "usage",
      sortOrder: 0,
      roleIds: [],
      hiddenInPlanIds: [],
    },
    {
      id: "_default_billing",
      componentName: "billing",
      sortOrder: 1,
      roleIds: [],
      hiddenInPlanIds: [],
    },
    {
      id: "_default_users",
      componentName: "users-list",
      sortOrder: 2,
      roleIds: ["admin"],
      hiddenInPlanIds: [],
    },
    {
      id: "_default_company",
      componentName: "company-edit",
      sortOrder: 3,
      roleIds: ["admin"],
      hiddenInPlanIds: [],
    },
    {
      id: "_default_apps",
      componentName: "connected-apps",
      sortOrder: 4,
      roleIds: [],
      hiddenInPlanIds: [],
    },
    {
      id: "_default_tokens",
      componentName: "tokens",
      sortOrder: 5,
      roleIds: [],
      hiddenInPlanIds: [],
    },
    {
      id: "_default_connected_services",
      componentName: "connected-services",
      sortOrder: 6,
      roleIds: [],
      hiddenInPlanIds: [],
    },
  ];
}

// Components whose /path conflicts with a (core) route group page.
// Non-superusers must skip these — the core layout would redirect them back to /entry.
const CORE_CONFLICT_COMPONENTS = new Set(["usage"]);

function findFirstComponent(
  items: {
    componentName?: string;
    children?: { componentName?: string; children?: any[] }[];
  }[],
  isSuperuser: boolean,
): string | null {
  for (const item of items) {
    if (item.componentName) {
      if (isSuperuser || !CORE_CONFLICT_COMPONENTS.has(item.componentName)) {
        return item.componentName;
      }
    }
    if (item.children?.length) {
      const found = findFirstComponent(item.children, isSuperuser);
      if (found) return found;
    }
  }
  return null;
}

export default function EntryPage() {
  const router = useRouter();
  const ctx = useTenantContext();
  const { systemToken, exchangeTenant, roles, loading: authLoading } = ctx;

  useEffect(() => {
    if (authLoading) return;
    if (!systemToken) {
      router.replace("/login");
      return;
    }

    const cancelled = { value: false };

    async function init() {
      try {
        // Fetch user's companies
        const compRes = await fetch("/api/companies", {
          headers: { Authorization: `Bearer ${systemToken}` },
        });
        const compJson = await compRes.json();
        const companies = compJson.success ? (compJson.items ?? []) : [];

        if (cancelled.value) return;
        if (companies.length === 0) {
          router.replace("/onboarding/company");
          return;
        }

        ctx.setCompanies(
          companies.map((c: { id: string; name: string }) => ({
            id: c.id,
            name: c.name,
          })),
        );

        const savedCompanyId = getCookie(COMPANY_COOKIE);
        const validCompany = companies.find((c: { id: string }) =>
          c.id === savedCompanyId
        );
        const activeCompanyId = validCompany
          ? validCompany.id
          : companies[0].id;

        const sysRes = await fetch(
          `/api/companies/${activeCompanyId}/systems`,
          { headers: { Authorization: `Bearer ${systemToken}` } },
        );
        const sysJson = await sysRes.json();
        const systems = sysJson.success ? (sysJson.data ?? []) : [];

        if (cancelled.value) return;
        if (systems.length === 0) {
          router.replace("/onboarding/system");
          return;
        }

        ctx.setSystems(
          systems.map((
            s: {
              id: string;
              name: string;
              slug: string;
              logoUri: string;
              defaultLocale?: string;
            },
          ) => ({
            id: s.id,
            name: s.name,
            slug: s.slug,
            logoUri: s.logoUri,
            defaultLocale: s.defaultLocale,
          })),
        );

        const savedSystemId = getCookie(SYSTEM_COOKIE);
        const validSystem = systems.find((s: { id: string }) =>
          s.id === savedSystemId
        );
        const activeSys = validSystem ?? systems[0];
        setCookie(SYSTEM_COOKIE, activeSys.id);

        if (cancelled.value) return;

        // Exchange token
        let currentToken = systemToken!;
        try {
          const exchangeResult = await exchangeTenant(
            activeCompanyId,
            activeSys.id,
          );
          currentToken = exchangeResult.systemToken ?? currentToken;
        } catch { /* ignore */ }

        if (cancelled.value) return;

        // Load plan
        let plan: { id: string; name: string } | null = null;
        try {
          const billingRes = await fetch("/api/billing", {
            headers: { Authorization: `Bearer ${currentToken}` },
          });
          const billingJson = await billingRes.json();
          if (billingJson.success) {
            const activeSub = (billingJson.data?.subscriptions ?? []).find(
              (s: { status: string }) => s.status === "active",
            );
            if (activeSub?.planId) {
              plan = { id: activeSub.planId, name: activeSub.planId };
            }
          }
        } catch { /* ignore */ }
        ctx.setPlan(plan);

        if (cancelled.value) return;

        // Load menus
        let tree: {
          componentName?: string;
          children?: { componentName?: string; children?: any[] }[];
        }[] = [];
        try {
          const menuRes = await fetch(
            `/api/core/menus?systemId=${
              encodeURIComponent(activeSys.id)
            }&limit=200`,
            { headers: { Authorization: `Bearer ${currentToken}` } },
          );
          const menuJson = await menuRes.json();
          const customItems: {
            componentName?: string;
            children?: { componentName?: string; children?: any[] }[];
            sortOrder: number;
            roleIds: string[];
            hiddenInPlanIds: string[];
          }[] = menuJson.data ?? [];
          const defaults = getDefaultMenus();
          const maxCustomSort = customItems.reduce(
            (max, item) => Math.max(max, item.sortOrder),
            -1,
          );
          const offsetDefaults = defaults.map((d) => ({
            ...d,
            sortOrder: d.sortOrder + maxCustomSort + 1,
          }));
          const flatItems = [...customItems, ...offsetDefaults];
          const visible = flatItems.filter((item) => {
            if (
              item.roleIds.length > 0 &&
              !item.roleIds.some((r) => roles.includes(r))
            ) return false;
            if (plan && item.hiddenInPlanIds.includes(plan.id)) return false;
            return true;
          });
          visible.sort((a, b) => a.sortOrder - b.sortOrder);
          tree = visible;
        } catch { /* ignore */ }

        if (cancelled.value) return;

        const isSuperuser = roles.includes("superuser");
        const first = findFirstComponent(tree, isSuperuser);
        if (first) {
          router.replace(`/${first}`);
        }
      } catch {
        // Network error — stay on this page
      }
    }

    init();
    return () => {
      cancelled.value = true;
    };
    // systemToken is read from closure on first run only — exchangeTenant updates
    // it in context but we deliberately exclude it from deps to avoid re-triggering.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading]);

  return (
    <div className="flex h-screen items-center justify-center">
      <Spinner size="lg" />
    </div>
  );
}
