import type { Tenant } from "./tenant.ts";

/**
 * API token row. The row id is the universal actor id (§8.11); the bearer
 * is a JWT (§8.1) embedding it. There is no separate token hash or jti.
 */
export interface ApiToken {
  id: string;
  userId: string;
  tenant: Tenant;
  companyId: string; // mirrors tenant.companyId — denormalized for indexing
  systemId: string; // mirrors tenant.systemId — denormalized for indexing
  name: string;
  description?: string;
  permissions: string[]; // duplicated into tenant.permissions at issue time
  monthlySpendLimit?: number;
  maxOperationCount?: Record<string, number>; // per-resourceKey operation count cap
  neverExpires: boolean; // mutually exclusive with expiresAt
  expiresAt?: string; // null when neverExpires is true
  frontendUse: boolean; // allowed from browsers (CORS enforcement)
  frontendDomains: string[]; // allowed origins when frontendUse=true
  revokedAt?: string;
  createdAt: string;
}
