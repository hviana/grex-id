import type { Tenant } from "@/src/contracts/tenant";

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
