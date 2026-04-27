export type TenantActorType = "user" | "api_token";

export interface Tenant {
  id?: string;
  systemId?: string;
  companyId?: string;
  systemSlug?: string;
  roles?: string[];
  actorType?: TenantActorType;
  actorId?: string;
  exchangeable?: boolean;
  exp?: number;
  frontendUse?: boolean;
  frontendDomains?: string[];
}
