"use client";

import { createContext, useCallback, useContext, useState } from "react";
import type { Company } from "@/src/contracts/company";
import type { System } from "@/src/contracts/system";
import { setCookie } from "@/src/lib/cookies";
import { useAuth } from "./useAuth";

const COMPANY_COOKIE = "core_company";
const SYSTEM_COOKIE = "core_system";

interface SystemContextState {
  companies: Pick<Company, "id" | "name">[];
  systems: Pick<System, "id" | "name" | "slug" | "logoUri" | "defaultLocale">[];
  plan: { id: string; name: string } | null;
}

export interface SystemContextValue extends SystemContextState {
  companyId: string | null;
  systemId: string | null;
  systemSlug: string | null;
  roles: string[];
  setCompanies: (companies: Pick<Company, "id" | "name">[]) => void;
  setSystems: (
    systems: Pick<
      System,
      "id" | "name" | "slug" | "logoUri" | "defaultLocale"
    >[],
  ) => void;
  setPlan: (plan: { id: string; name: string } | null) => void;
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
      setCookie(SYSTEM_COOKIE, "");
      setState((prev) => ({
        ...prev,
        systems: [],
        plan: null,
      }));
    },
    [],
  );

  const switchSystem = useCallback(
    (systemId: string) => {
      setCookie(SYSTEM_COOKIE, systemId);
      const sys = state.systems.find((s) => s.id === systemId);
      if (sys && tenant.companyId) {
        exchangeTenant(tenant.companyId, systemId).catch(console.error);
      }
      setState((prev) => ({ ...prev, plan: null }));
    },
    [state.systems, tenant.companyId, exchangeTenant],
  );

  return {
    companyId: tenant.companyId || null,
    systemId: tenant.systemId || null,
    systemSlug: tenant.systemSlug && tenant.systemSlug !== "core"
      ? tenant.systemSlug
      : null,
    roles: tenant.roles,
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
