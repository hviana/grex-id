export interface Tenant {
  systemId: string; // "0" for unauthenticated / non-tenant contexts
  companyId: string; // "0" for unauthenticated / non-tenant contexts
  systemSlug: string; // "core" for core-scoped routes; else the system slug
  roles: string[]; // [] for anonymous / app-token tenants
  permissions: string[]; // [] for anonymous; "*" wildcard allowed
}

export type TenantActorType =
  | "user"
  | "api_token"
  | "connected_app"
  | "anonymous";

export interface TenantClaims extends Tenant {
  actorType: TenantActorType;
  actorId: string; // user/token/app id; "0" for anonymous
  jti: string; // unique token id for revocation
  exchangeable: boolean; // true only for actorType="user"
  exp?: number; // unix seconds — present on JWT-decoded claims; absent for API tokens
}
