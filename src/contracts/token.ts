/**
 * API token row. The row id is the universal actor id (§8.11); the bearer
 * is a JWT (§8.1) embedding it. There is no separate token hash or jti.
 */
export interface ApiToken {
  id: string;
  tenantIds: string[]; // references tenant rows — universal scope key
  name: string;
  description?: string;
  roles: string[]; // duplicated into tenant.roles at issue time
  monthlySpendLimit?: number;
  maxOperationCount?: Record<string, number>; // per-resourceKey operation count cap
  neverExpires: boolean; // mutually exclusive with expiresAt
  expiresAt?: string; // null when neverExpires is true
  frontendUse: boolean; // allowed from browsers (CORS enforcement)
  frontendDomains: string[]; // allowed origins when frontendUse=true
  revokedAt?: string;
  createdAt: string;
}
