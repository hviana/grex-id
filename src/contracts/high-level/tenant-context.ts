import type { Tenant } from "@/src/contracts/tenant";
import type { UserResolved } from "./user";
import type { Company } from "@/src/contracts/company";
import type { System } from "@/src/contracts/system";
import type { PublicSystemInfo } from "./systems";
import type { SupportedLocale } from "./i18n";

export type TenantActorType = "user" | "api_token";

export interface TenantContext {
  tenant: Tenant;
  roles: string[];
  actorType: TenantActorType;
  exchangeable: boolean;
  frontendDomains: string[];
  systemSlug?: string;
}

export interface RequestContext {
  tenantContext: TenantContext;
}

// ============================================================================
// Frontend auth contracts — consumed by TenantProvider and useTenantContext.
// ============================================================================

/** Auth claims returned alongside the token by auth endpoints. Mirrors the
 *  server-side TenantContext fields that the frontend needs for rendering. */
export interface AuthClaims {
  roles: string[];
  actorType: TenantActorType | null;
  exchangeable: boolean;
  frontendDomains: string[];
}

/** Full context value exposed by TenantProvider via useTenantContext(). */
export interface TenantContextValue {
  user: UserResolved | null;
  systemToken: string | null;
  anonymousToken: string | null;
  loading: boolean;
  tenant: Tenant;
  roles: string[];
  actorType: TenantActorType | null;
  exchangeable: boolean;
  frontendDomains: string[];
  login: (
    identifier: string,
    password: string,
    stayLoggedIn?: boolean,
    twoFactorCode?: string,
  ) => Promise<{ user: UserResolved; systemToken: string }>;
  logout: () => void;
  refresh: (token?: string) => Promise<void>;
  exchangeTenant: (
    companyId: string,
    systemId: string,
  ) => Promise<{ systemToken: string }>;
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;
  t: (key: string, params?: Record<string, string>) => string;
  supportedLocales: readonly string[];
  companies: Pick<Company, "id" | "name">[];
  systems: Pick<System, "id" | "name" | "slug" | "logoUri" | "defaultLocale">[];
  plan: { id: string; name: string } | null;
  companyId: string | null;
  systemId: string | null;
  systemSlug: string | null;
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
  getSetting: (key: string) => string | undefined;
  frontCoreLoaded: boolean;
  reloadFrontCore: () => Promise<void>;
  publicSystem: PublicSystemInfo | null;
  publicSystemLoading: boolean;
  loadPublicSystem: (slug?: string) => Promise<void>;
}
