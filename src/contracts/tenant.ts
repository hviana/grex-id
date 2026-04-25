export interface Tenant {
  // All values are real SurrealDB record IDs — no sentinels.
  systemId: string;
  companyId: string;
  systemSlug: string; // "core" for core-scoped routes; else the system slug
  roles: string[]; // [] for anonymous-role tenants
  permissions: string[]; // [] for anonymous-role tenants; "*" wildcard allowed
}

export type TenantActorType = "user" | "api_token" | "connected_app";

export interface TenantClaims extends Tenant {
  actorType: TenantActorType;
  actorId: string; // universal actor id — user id or api_token id; always a real SurrealDB record ID
  exchangeable: boolean; // true only for actorType="user"
  exp?: number; // unix seconds — present on JWT-decoded claims
  // Frontend-bearer CORS policy (§8.12). Only present on tokens issued for
  // non-user actors (api_token / connected_app). Embedded in the JWT so
  // withAuth can enforce CORS without a DB read.
  frontendUse?: boolean;
  frontendDomains?: string[];
}
