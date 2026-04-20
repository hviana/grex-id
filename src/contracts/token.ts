import type { Tenant } from "./tenant.ts";

export interface ApiToken {
  id: string;
  userId: string;
  tenant: Tenant;
  companyId: string; // mirrors tenant.companyId — denormalized for indexing
  systemId: string; // mirrors tenant.systemId — denormalized for indexing
  name: string;
  description?: string;
  tokenHash: string;
  jti: string; // unique — used for revocation
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
