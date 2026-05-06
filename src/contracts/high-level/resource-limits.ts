// ============================================================================
// Pre-computed merged resource limits (plan + voucher) cached per tenant.
// ============================================================================

export interface TenantResourceLimits {
  roles: string[];
  entityLimits: Record<string, number>;
  apiRateLimit: number;
  storageLimitBytes: number;
  fileCacheLimitBytes: number;
  credits: number;
  maxConcurrentDownloads: number;
  maxConcurrentUploads: number;
  maxDownloadBandwidthMB: number;
  maxUploadBandwidthMB: number;
  maxOperationCountByResourceKey: Record<string, number>;
  creditLimitByResourceKey: Record<string, number>;
  frontendDomains: string[];
}

// ============================================================================
// Display-oriented resource limits — used by ResourceLimitsView, PlanCard,
// VoucherCard, BillingPage, and other frontend components. All fields are
// optional and nullable to support partial data from different sources.
// ============================================================================

export interface ResourceLimitsData {
  benefits?: string[] | null;
  roleIds?: string[] | null;
  entityLimits?: Record<string, number> | null;
  apiRateLimit?: number;
  storageLimitBytes?: number;
  fileCacheLimitBytes?: number;
  credits?: number;
  priceModifier?: number;
  maxConcurrentDownloads?: number;
  maxConcurrentUploads?: number;
  maxDownloadBandwidthMB?: number;
  maxUploadBandwidthMB?: number;
  maxOperationCountByResourceKey?: Record<string, number> | null;
  creditLimitByResourceKey?: Record<string, number> | null;
  frontendDomains?: string[] | null;
}

/** Field names exposed by ResourceLimitsSubform. */
export type ResourceLimitField =
  | "benefits"
  | "roleIds"
  | "entityLimits"
  | "apiRateLimit"
  | "storageLimitBytes"
  | "fileCacheLimitBytes"
  | "credits"
  | "maxConcurrentDownloads"
  | "maxConcurrentUploads"
  | "maxDownloadBandwidthMB"
  | "maxUploadBandwidthMB"
  | "maxOperationCountByResourceKey"
  | "creditLimitByResourceKey"
  | "priceModifier"
  | "frontendDomains";

// ============================================================================
// Guard result types (returned by server/utils/guards.ts)
// ============================================================================

export interface EntityLimitResult {
  limit: number | null;
  planLimit: number | null;
  voucherModifier: number;
}

export interface PlanAccessResult {
  granted: boolean;
  denyCode?: "NO_SUBSCRIPTION" | "SUBSCRIPTION_EXPIRED" | "PLAN_LIMIT";
}

export interface RateLimitConfigResult {
  globalLimit: number;
  planRateLimit: number;
  voucherModifier: number;
}

export interface FileCacheLimitResult {
  maxBytes: number;
  planLimit: number;
  voucherModifier: number;
}

export interface TransferLimitResult {
  max: number;
  planLimit: number;
  voucherModifier: number;
}
