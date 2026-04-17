"use client";

import { createContext, useCallback, useContext, useState } from "react";
import type { Company } from "@/src/contracts/company";
import type { System } from "@/src/contracts/system";
import { setCookie } from "@/src/lib/cookies";
import { useAuth } from "./useAuth.ts";

const COMPANY_COOKIE = "core_company";
const SYSTEM_COOKIE = "core_system";

interface SystemContextState {
  companies: Pick<Company, "id" | "name">[];
  systems: Pick<System, "id" | "name" | "slug" | "logoUri" | "defaultLocale">[];
  plan: { id: string; name: string } | null;
}

export interface SystemContextValue extends SystemContextState {
  // Derived from useAuth().tenant (read-only)
  companyId: string | null;
  systemId: string | null;
  systemSlug: string | null;
  roles: string[];
  permissions: string[];
  // Managed state (fetched, not in JWT)
  setCompanies: (companies: Pick<Company, "id" | "name">[]) => void;
  setSystems: (
    systems: Pick<
      System,
      "id" | "name" | "slug" | "logoUri" | "defaultLocale"
    >[],
  ) => void;
  setPlan: (plan: { id: string; name: string } | null) => void;
  // Switchers — perform token exchange
  switchCompany: (companyId: string) => void;
  switchSystem: (systemId: string) => void;
}

export const SystemContext = createContext<SystemContextValue | null>(null);

export function useSystemContextProvider(): SystemContextValue {
  const { tenant, exchangeTenant } = useAuth();

  const [state, setState] = useState<SystemContextState>({
    companies: [],
    systems: [],
    plan: null,
  });

  const setCompanies = useCallback(
    (companies: Pick<Company, "id" | "name">[]) => {
      setState((prev) => ({ ...prev, companies }));
    },
    [],
  );

  const setSystems = useCallback(
    (
      systems: Pick<
        System,
        "id" | "name" | "slug" | "logoUri" | "defaultLocale"
      >[],
    ) => {
      setState((prev) => ({ ...prev, systems }));
    },
    [],
  );

  const setPlan = useCallback(
    (plan: { id: string; name: string } | null) => {
      setState((prev) => ({ ...prev, plan }));
    },
    [],
  );

  const switchCompany = useCallback(
    (companyId: string) => {
      setCookie(COMPANY_COOKIE, companyId);
      // Reset system — the layout will load systems for the new company
      setCookie(SYSTEM_COOKIE, "");
      setState((prev) => ({
        ...prev,
        systems: [],
        plan: null,
      }));
      // The layout will handle the token exchange after loading systems
    },
    [],
  );

  const switchSystem = useCallback(
    (systemId: string) => {
      setCookie(SYSTEM_COOKIE, systemId);
      // Find the system to get company+system for exchange
      const sys = state.systems.find((s) => s.id === systemId);
      if (sys && tenant.companyId && tenant.companyId !== "0") {
        exchangeTenant(tenant.companyId, systemId).catch(console.error);
      }
      setState((prev) => ({ ...prev, plan: null }));
    },
    [state.systems, tenant.companyId, exchangeTenant],
  );

  return {
    // Derived from tenant (JWT is the single source of truth)
    companyId: tenant.companyId !== "0" ? tenant.companyId : null,
    systemId: tenant.systemId !== "0" ? tenant.systemId : null,
    systemSlug: tenant.systemSlug !== "core" ? tenant.systemSlug : null,
    roles: tenant.roles,
    permissions: tenant.permissions,
    // Managed state
    ...state,
    setCompanies,
    setSystems,
    setPlan,
    switchCompany,
    switchSystem,
  };
}

export function useSystemContext(): SystemContextValue {
  const ctx = useContext(SystemContext);
  if (!ctx) {
    throw new Error(
      "useSystemContext must be used within a SystemContextProvider",
    );
  }
  return ctx;
}
