"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Sidebar from "@/src/components/shared/Sidebar";
import ProfileMenu from "@/src/components/shared/ProfileMenu";
import LocaleSelector from "@/src/components/shared/LocaleSelector";
import Spinner from "@/src/components/shared/Spinner";
import type { MenuItem } from "@/src/contracts/menu";
import { useTenantContext } from "@/src/hooks/useTenantContext";
import { type SupportedLocale, supportedLocales } from "@/src/i18n";
import { getCookie, setCookie } from "@/src/lib/cookies";

const COMPANY_COOKIE = "core_company";
const SYSTEM_COOKIE = "core_system";

/**
 * Returns a default set of menu items when no menus are configured for the system.
 * These represent the shared/common pages available to all systems.
 */
function getDefaultMenus(): MenuItem[] {
  return [
    {
      id: "_default_usage",
      tenantIds: [],
      parentId: undefined,
      label: "common.menu.usage",
      emoji: "📊",
      componentName: "usage",
      sortOrder: 0,
      requiredRoles: [],
      hiddenInPlanIds: [],
      createdAt: "",
    },
    {
      id: "_default_billing",
      tenantIds: [],
      parentId: undefined,
      label: "common.menu.billing",
      emoji: "💳",
      componentName: "billing",
      sortOrder: 1,
      requiredRoles: [],
      hiddenInPlanIds: [],
      createdAt: "",
    },
    {
      id: "_default_users",
      tenantIds: [],
      parentId: undefined,
      label: "common.menu.users",
      emoji: "👥",
      componentName: "users-list",
      sortOrder: 2,
      requiredRoles: ["admin"],
      hiddenInPlanIds: [],
      createdAt: "",
    },
    {
      id: "_default_company",
      tenantIds: [],
      parentId: undefined,
      label: "common.menu.company",
      emoji: "🏢",
      componentName: "company-edit",
      sortOrder: 3,
      requiredRoles: ["admin"],
      hiddenInPlanIds: [],
      createdAt: "",
    },
    {
      id: "_default_apps",
      tenantIds: [],
      parentId: undefined,
      label: "common.menu.connectedApps",
      emoji: "🔌",
      componentName: "connected-apps",
      sortOrder: 4,
      requiredRoles: [],
      hiddenInPlanIds: [],
      createdAt: "",
    },
    {
      id: "_default_tokens",
      tenantIds: [],
      parentId: undefined,
      label: "common.menu.tokens",
      emoji: "🔑",
      componentName: "tokens",
      sortOrder: 5,
      requiredRoles: [],
      hiddenInPlanIds: [],
      createdAt: "",
    },
    {
      id: "_default_connected_services",
      tenantIds: [],
      parentId: undefined,
      label: "common.menu.connectedServices",
      emoji: "🔗",
      componentName: "connected-services",
      sortOrder: 6,
      requiredRoles: [],
      hiddenInPlanIds: [],
      createdAt: "",
    },
    {
      id: "_default_groups",
      tenantIds: [],
      parentId: undefined,
      label: "common.menu.groups",
      emoji: "👥",
      componentName: "groups",
      sortOrder: 7,
      requiredRoles: ["admin"],
      hiddenInPlanIds: [],
      createdAt: "",
    },
  ];
}

function buildMenuTree(
  flatItems: MenuItem[],
  userRoles: string[],
  activePlanId: string | null,
): MenuItem[] {
  const visible = flatItems.filter((item) => {
    if (
      item.requiredRoles.length > 0 &&
      !item.requiredRoles.some((r) => userRoles.includes(r))
    ) {
      return false;
    }
    if (activePlanId && item.hiddenInPlanIds.includes(activePlanId)) {
      return false;
    }
    return true;
  });

  const map = new Map<string, MenuItem>();
  for (const item of visible) {
    map.set(item.id, { ...item, children: [] });
  }

  const roots: MenuItem[] = [];
  for (const item of map.values()) {
    if (item.parentId && map.has(item.parentId)) {
      const parent = map.get(item.parentId)!;
      parent.children = parent.children ?? [];
      parent.children.push(item);
    } else {
      roots.push(item);
    }
  }

  const sortItems = (items: MenuItem[]) => {
    items.sort((a, b) => a.sortOrder - b.sortOrder);
    for (const item of items) {
      if (item.children?.length) sortItems(item.children);
    }
  };
  sortItems(roots);
  return roots;
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const ctx = useTenantContext();
  const {
    systemToken,
    exchangeTenant,
    roles,
    loading: authLoading,
    t,
    setLocale,
  } = ctx;
  const [menus, setMenus] = useState<MenuItem[]>([]);
  const [initializing, setInitializing] = useState(true);

  // Fetch menus for the active system
  const loadMenus = useCallback(async (
    sysId: string,
    roles: string[],
    planId: string | null,
    token: string,
  ): Promise<MenuItem[]> => {
    try {
      const res = await fetch(
        `/api/core/menus?systemId=${encodeURIComponent(sysId)}&limit=200`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const json = await res.json();
      const customItems: MenuItem[] = json.data ?? [];
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
      const tree = buildMenuTree(flatItems, roles, planId);
      setMenus(tree);
      return tree;
    } catch {
      const tree = buildMenuTree(getDefaultMenus(), roles, planId);
      setMenus(tree);
      return tree;
    }
  }, []);

  // Load plan for the active subscription
  const loadPlan = useCallback(async (
    cId: string,
    sId: string,
    token: string,
  ): Promise<{ id: string; name: string } | null> => {
    try {
      const billingRes = await fetch(
        `/api/billing`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const billingJson = await billingRes.json();
      if (billingJson.success) {
        const activeSub = (billingJson.data?.subscriptions ?? []).find(
          (s: { status: string }) => s.status === "active",
        );
        if (activeSub?.planId) {
          return { id: activeSub.planId, name: activeSub.planId };
        }
      }
    } catch { /* ignore */ }
    return null;
  }, []);

  const activeSystem = ctx.systems.find((s) => s.id === ctx.systemId);
  const systemLogoUrl = activeSystem?.logoUri
    ? `/api/files/download?uri=${encodeURIComponent(activeSystem.logoUri)}`
    : undefined;

  // Apply the active system's default locale when no user preference is set
  useEffect(() => {
    if (
      activeSystem?.defaultLocale &&
      (supportedLocales as readonly string[]).includes(
        activeSystem.defaultLocale,
      ) &&
      !document.cookie.includes("core_locale")
    ) {
      setLocale(activeSystem.defaultLocale as SupportedLocale);
    }
  }, [activeSystem?.defaultLocale, setLocale]);

  // Load menus when system context is ready
  useEffect(() => {
    if (authLoading || !systemToken || !ctx.systemId || !ctx.companyId) return;

    let cancelled = false;

    async function load() {
      try {
        const token = systemToken!;
        // Load plan
        let planId: string | null = null;
        try {
          const billingRes = await fetch("/api/billing", {
            headers: { Authorization: `Bearer ${token}` },
          });
          const billingJson = await billingRes.json();
          if (billingJson.success) {
            const activeSub = (billingJson.data?.subscriptions ?? []).find(
              (s: { status: string }) => s.status === "active",
            );
            if (activeSub?.planId) planId = activeSub.planId;
          }
        } catch { /* ignore */ }

        if (cancelled) return;

        // Load menus
        const tree = await loadMenus(
          ctx.systemId!,
          roles ?? [],
          planId,
          token,
        );
        if (!cancelled) setInitializing(false);
        return tree;
      } catch {
        if (!cancelled) setInitializing(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, ctx.systemId, ctx.companyId]);

  // Reload systems and menus when company changes
  const companyIdRef = useRef(ctx.companyId);
  useEffect(() => {
    if (initializing || !systemToken || !ctx.companyId) return;
    if (companyIdRef.current === ctx.companyId) return;
    companyIdRef.current = ctx.companyId;

    let cancelled = false;

    async function reloadForCompany() {
      try {
        const sysRes = await fetch(
          `/api/companies/${ctx.companyId}/systems`,
          { headers: { Authorization: `Bearer ${systemToken}` } },
        );
        const sysJson = await sysRes.json();
        const systems = sysJson.success ? (sysJson.data ?? []) : [];

        if (cancelled) return;

        const mappedSystems = systems.map(
          (s: {
            id: string;
            name: string;
            slug: string;
            logoUri: string;
            defaultLocale?: string;
          }) => ({
            id: s.id,
            name: s.name,
            slug: s.slug,
            logoUri: s.logoUri,
            defaultLocale: s.defaultLocale,
          }),
        );
        ctx.setSystems(mappedSystems);

        if (systems.length > 0) {
          const firstSys = systems[0];
          setCookie(SYSTEM_COOKIE, firstSys.id);

          let currentToken = systemToken!;
          try {
            const exchangeResult = await exchangeTenant(
              ctx.companyId!,
              firstSys.id,
            );
            currentToken = exchangeResult.systemToken ?? currentToken;
          } catch { /* ignore */ }

          if (cancelled) return;

          const plan = await loadPlan(
            ctx.companyId!,
            firstSys.id,
            currentToken,
          );
          ctx.setPlan(plan);

          await loadMenus(
            firstSys.id,
            roles ?? [],
            plan?.id ?? null,
            currentToken,
          );
        } else {
          setMenus([]);
        }
      } catch { /* ignore */ }
    }

    reloadForCompany();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.companyId]);

  // Reload menus when system changes
  const systemIdRef = useRef(ctx.systemId);
  useEffect(() => {
    if (initializing || !systemToken || !ctx.companyId || !ctx.systemId) return;
    if (systemIdRef.current === ctx.systemId) return;
    systemIdRef.current = ctx.systemId;

    let cancelled = false;

    async function reloadForSystem() {
      try {
        let currentToken = systemToken!;
        try {
          const exchangeResult = await exchangeTenant(
            ctx.companyId!,
            ctx.systemId!,
          );
          currentToken = exchangeResult.systemToken ?? currentToken;
        } catch { /* ignore */ }

        if (cancelled) return;

        const plan = await loadPlan(
          ctx.companyId!,
          ctx.systemId!,
          currentToken,
        );
        ctx.setPlan(plan);

        await loadMenus(
          ctx.systemId!,
          roles ?? [],
          plan?.id ?? null,
          currentToken,
        );
      } catch { /* ignore */ }
    }

    reloadForSystem();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.systemId]);

  const activeComponent = pathname?.replace(/^\/+/, "") || undefined;

  const handleNavigate = (componentName: string) => {
    router.push(`/${componentName}`);
  };

  if (authLoading || initializing) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--color-black)]">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[var(--color-black)]">
      {!pathname.startsWith("/onboarding") && (
        <Sidebar
          menus={menus}
          systemLogo={systemLogoUrl}
          systemName={activeSystem?.name}
          activeComponent={activeComponent}
          onNavigate={handleNavigate}
        />
      )}

      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        {!pathname.startsWith("/onboarding") && (
          <header className="flex items-center justify-end gap-3 px-4 py-3 border-b border-[var(--color-dark-gray)] bg-[#0a0a0a]">
            <LocaleSelector />
            <ProfileMenu />
          </header>
        )}

        {/* Content */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
