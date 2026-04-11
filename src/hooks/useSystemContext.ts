"use client";

import { createContext, useCallback, useContext, useState } from "react";
import type { Company } from "@/src/contracts/company";
import type { System } from "@/src/contracts/system";

const COMPANY_COOKIE = "core_company";
const SYSTEM_COOKIE = "core_system";

function getCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match?.[1];
}

function setCookie(name: string, value: string): void {
  if (typeof document === "undefined") return;
  const expires = new Date(Date.now() + 365 * 86400000).toUTCString();
  document.cookie =
    `${name}=${value}; expires=${expires}; path=/; SameSite=Lax`;
}

interface SystemContextState {
  companyId: string | null;
  systemId: string | null;
  systemSlug: string | null;
  plan: { id: string; name: string } | null;
  roles: string[];
  companies: Pick<Company, "id" | "name">[];
  systems: Pick<System, "id" | "name" | "slug" | "logoUri" | "defaultLocale">[];
}

export interface SystemContextValue extends SystemContextState {
  setCompany: (companyId: string) => void;
  setSystem: (systemId: string, systemSlug: string) => void;
  setPlan: (plan: { id: string; name: string } | null) => void;
  setRoles: (roles: string[]) => void;
  setCompanies: (companies: Pick<Company, "id" | "name">[]) => void;
  setSystems: (
    systems: Pick<
      System,
      "id" | "name" | "slug" | "logoUri" | "defaultLocale"
    >[],
  ) => void;
  switchCompany: (companyId: string) => void;
  switchSystem: (systemId: string) => void;
}

export const SystemContext = createContext<SystemContextValue | null>(null);

export function useSystemContextProvider(): SystemContextValue {
  const [state, setState] = useState<SystemContextState>(() => ({
    companyId: getCookie(COMPANY_COOKIE) ?? null,
    systemId: getCookie(SYSTEM_COOKIE) ?? null,
    systemSlug: null,
    plan: null,
    roles: [],
    companies: [],
    systems: [],
  }));

  const setCompany = useCallback((companyId: string) => {
    setCookie(COMPANY_COOKIE, companyId);
    setState((prev) => ({ ...prev, companyId }));
  }, []);

  const setSystem = useCallback((systemId: string, systemSlug: string) => {
    setCookie(SYSTEM_COOKIE, systemId);
    setState((prev) => ({ ...prev, systemId, systemSlug }));
  }, []);

  const setPlan = useCallback((plan: { id: string; name: string } | null) => {
    setState((prev) => ({ ...prev, plan }));
  }, []);

  const setRoles = useCallback((roles: string[]) => {
    setState((prev) => ({ ...prev, roles }));
  }, []);

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

  const switchCompany = useCallback(
    (companyId: string) => {
      setCookie(COMPANY_COOKIE, companyId);
      // Reset system — the layout will load systems for the new company
      setCookie(SYSTEM_COOKIE, "");
      setState((prev) => ({
        ...prev,
        companyId,
        systemId: null,
        systemSlug: null,
        plan: null,
        roles: [],
        systems: [],
      }));
    },
    [],
  );

  const switchSystem = useCallback((systemId: string) => {
    setCookie(SYSTEM_COOKIE, systemId);
    setState((prev) => {
      const sys = prev.systems.find((s) => s.id === systemId);
      return {
        ...prev,
        systemId,
        systemSlug: sys?.slug ?? null,
        plan: null,
        roles: [],
      };
    });
  }, []);

  return {
    ...state,
    setCompany,
    setSystem,
    setPlan,
    setRoles,
    setCompanies,
    setSystems,
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
