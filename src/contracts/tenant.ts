export type TenantActorType = "user" | "api_token";

export interface Tenant {
  id?: string;
  systemId?: string;
  companyId?: string;
  systemSlug?: string;
  actorType?: TenantActorType;
  actorId?: string;
  exchangeable?: boolean;
  exp?: number;
}
