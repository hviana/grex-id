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
  actorId: string; // universal actor id — user id or api_token id; "0" for anonymous
  exchangeable: boolean; // true only for actorType="user"
  exp?: number; // unix seconds — present on JWT-decoded claims
  // Frontend-bearer CORS policy (§12.7). Only present on tokens issued for
  // non-user actors (api_token / connected_app). Embedded in the JWT so
  // withAuth can enforce CORS without a DB read.
  frontendUse?: boolean;
  frontendDomains?: string[];
}
