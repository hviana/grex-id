import type { ResourceLimit } from "./resource-limit.ts";

/**
 * API token row. The row id is the universal actor id (§8.11); the bearer
 * is a JWT (§8.1) embedding it. There is no separate token hash or jti.
 *
 * actorType "token" = regular API token; "app" = connected app (replaces
 * the former connected_app entity). Resource limits are stored in the
 * referenced resource_limit composable.
 */
export interface ApiToken {
  id: string;
  tenantIds: string[];
  name: string;
  description?: string;
  actorType: "app" | "token";
  resourceLimitId?: ResourceLimit;
  neverExpires: boolean;
  expiresAt?: string;
  revokedAt?: string;
  createdAt: string;
}
