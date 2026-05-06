import type { CoreCreditExpenseRow } from "./query-results";

/** Tenant filter entry sent from frontend for usage queries. */
export interface UsageTenantFilter {
  companyId?: string;
  systemId?: string;
  actorIds?: string[];
}

/** API response for GET /api/usage. */
export interface UsageData {
  /** Per-tenant subscription + credit data. */
  tenants: UsageTenantResult[];
  /** Aggregated credit expenses by resourceKey across all requested tenants. */
  creditExpenses: CoreCreditExpenseRow[];
}

export interface UsageTenantResult {
  companyId: string;
  systemId: string;
  actorId?: string;
  storage: {
    usedBytes: number;
    limitBytes: number;
  };
  subscription: {
    remainingPlanCredits: number;
    purchasedCredits: number;
    remainingOperationCount: Record<string, number> | null;
  } | null;
}
