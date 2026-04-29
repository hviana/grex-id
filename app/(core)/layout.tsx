"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "@/src/components/shared/Sidebar";
import Spinner from "@/src/components/shared/Spinner";
import LocaleSelector from "@/src/components/shared/LocaleSelector";
import { useTenantContext } from "@/src/hooks/useTenantContext";
import type { MenuItem } from "@/src/contracts/menu";

function useCoreMenus(t: (key: string) => string): MenuItem[] {
  return [
    {
      id: "c0",
      tenantIds: [],
      name: t("core.nav.companies"),
      emoji: "🏢",
      componentName: "companies",
      sortOrder: 0,
      roleIds: ["superuser"],
      hiddenInPlanIds: [],
      createdAt: "",
    },
    {
      id: "c1",
      tenantIds: [],
      name: t("core.nav.systems"),
      emoji: "🔌",
      componentName: "systems",
      sortOrder: 1,
      roleIds: ["superuser"],
      hiddenInPlanIds: [],
      createdAt: "",
    },
    {
      id: "c2",
      tenantIds: [],
      name: t("core.nav.roles"),
      emoji: "🛡️",
      componentName: "roles",
      sortOrder: 2,
      roleIds: ["superuser"],
      hiddenInPlanIds: [],
      createdAt: "",
    },
    {
      id: "c3",
      tenantIds: [],
      name: t("core.nav.plans"),
      emoji: "📋",
      componentName: "plans",
      sortOrder: 3,
      roleIds: ["superuser"],
      hiddenInPlanIds: [],
      createdAt: "",
    },
    {
      id: "c4",
      tenantIds: [],
      name: t("core.nav.vouchers"),
      emoji: "🎟️",
      componentName: "vouchers",
      sortOrder: 4,
      roleIds: ["superuser"],
      hiddenInPlanIds: [],
      createdAt: "",
    },
    {
      id: "c5",
      tenantIds: [],
      name: t("core.nav.menus"),
      emoji: "📑",
      componentName: "menus",
      sortOrder: 5,
      roleIds: ["superuser"],
      hiddenInPlanIds: [],
      createdAt: "",
    },
    {
      id: "c6",
      tenantIds: [],
      name: t("core.nav.terms"),
      emoji: "📜",
      componentName: "terms-manager",
      sortOrder: 6,
      roleIds: ["superuser"],
      hiddenInPlanIds: [],
      createdAt: "",
    },
    {
      id: "c7",
      tenantIds: [],
      name: t("core.nav.dataDeletion"),
      emoji: "🗑️",
      componentName: "data-deletion",
      sortOrder: 7,
      roleIds: ["superuser"],
      hiddenInPlanIds: [],
      createdAt: "",
    },
    {
      id: "c8",
      tenantIds: [],
      name: t("core.nav.settings"),
      emoji: "⚙️",
      componentName: "settings",
      sortOrder: 8,
      roleIds: ["superuser"],
      hiddenInPlanIds: [],
      createdAt: "",
    },
    {
      id: "c9",
      tenantIds: [],
      name: t("core.nav.frontSettings"),
      emoji: "🎨",
      componentName: "front-settings",
      sortOrder: 9,
      roleIds: ["superuser"],
      hiddenInPlanIds: [],
      createdAt: "",
    },
    {
      id: "c10",
      tenantIds: [],
      name: t("core.nav.fileAccess"),
      emoji: "📂",
      componentName: "file-access",
      sortOrder: 10,
      roleIds: ["superuser"],
      hiddenInPlanIds: [],
      createdAt: "",
    },
    {
      id: "c11",
      tenantIds: [],
      name: t("core.nav.usage"),
      emoji: "📊",
      componentName: "usage",
      sortOrder: 11,
      roleIds: ["superuser"],
      hiddenInPlanIds: [],
      createdAt: "",
    },
  ];
}

function CoreProfileMenu() {
  const { user, logout } = useTenantContext();
  const { t } = useTenantContext();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-white/5 transition-colors"
      >
        <div className="w-8 h-8 rounded-full bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] flex items-center justify-center text-sm font-bold text-black">
          {user?.profile?.name?.[0]?.toUpperCase() ?? "?"}
        </div>
        <span className="hidden sm:block text-sm text-white truncate max-w-32">
          {user?.profile?.name ?? t("common.user")}
        </span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-48 z-50 backdrop-blur-md bg-[#111]/95 border border-[var(--color-dark-gray)] rounded-lg shadow-lg overflow-hidden">
          {/* Profile */}
          <button
            onClick={() => {
              setOpen(false);
              router.push("/profile");
            }}
            className="w-full text-left px-4 py-3 text-sm text-[var(--color-light-text)] hover:bg-white/5 hover:text-white transition-colors"
          >
            👤 {t("common.profile.menu")}
          </button>

          <button
            onClick={() => {
              setOpen(false);
              logout();
              router.push("/login");
            }}
            className="w-full text-left px-4 py-3 text-sm text-red-400 hover:bg-white/5 transition-colors"
          >
            🚪 {t("common.profile.logout")}
          </button>
        </div>
      )}
    </div>
  );
}

export default function CoreLayout(
  { children }: { children: React.ReactNode },
) {
  const router = useRouter();
  const { t } = useTenantContext();
  const { tenant, roles, loading: authLoading } = useTenantContext();
  const coreMenus = useCoreMenus(t);

  // Superuser guard (§20)
  useEffect(() => {
    if (authLoading) return;
    if (!roles.includes("superuser")) {
      router.push("/entry");
    }
  }, [authLoading, roles, router]);

  const handleNavigate = (componentName: string) => {
    router.push(`/${componentName}`);
  };

  if (authLoading || !roles.includes("superuser")) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--color-black)]">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[var(--color-black)]">
      <Sidebar
        menus={coreMenus}
        systemName={t("core.layout.superuserPanel")}
        onNavigate={handleNavigate}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-dark-gray)] bg-[#0a0a0a]">
          <div className="text-sm font-medium text-[var(--color-light-text)] pl-12 lg:pl-0">
            🔒 {t("core.layout.superuserPanel")}
          </div>
          <div className="flex items-center gap-3">
            <LocaleSelector />
            <CoreProfileMenu />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
