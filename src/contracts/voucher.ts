import type { ResourceLimit } from "./resource-limit.ts";

/**
 * Voucher. Applicability and expiration live on the voucher row; every
 * modifier (price, rate, storage, transfer, operation count, credits) lives
 * in the referenced resource_limit composable. When valueMode is "modifier",
 * all numeric fields are signed deltas applied on top of the plan's absolute
 * limits.
 */
export interface Voucher {
  id: string;
  name: string;
  applicableTenantIds: string[];
  applicablePlanIds: string[];
  resourceLimitId?: ResourceLimit;
  expiresAt?: string;
  createdAt: string;
}
