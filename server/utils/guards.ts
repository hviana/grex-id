import Core, { type TenantResourceLimits } from "./Core.ts";
import { assertServerOnly } from "./server-only.ts";

assertServerOnly("guards.ts");

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

/** Internal: fetch tenant (CS) limits without subscription checks. */
async function getLimits(systemId: string, companyId: string): Promise<TenantResourceLimits> {
  const core = Core.getInstance();
  try {
    return await core.ensureTenantLimits(systemId, companyId);
  } catch {
    return {
      roles: [],
      entityLimits: {},
      apiRateLimit: 0,
      storageLimitBytes: 0,
      fileCacheLimitBytes: 0,
      credits: 0,
      maxConcurrentDownloads: 0,
      maxConcurrentUploads: 0,
      maxDownloadBandwidthMB: 0,
      maxUploadBandwidthMB: 0,
      maxOperationCountByResourceKey: {},
      creditLimitByResourceKey: {},
      frontendDomains: [],
    };
  }
}

export async function resolveEntityLimit(params: {
  systemId: string;
  companyId: string;
  entityName: string;
}): Promise<EntityLimitResult> {
  const limits = await getLimits(params.systemId, params.companyId);
  const planLimit = limits.entityLimits[params.entityName];

  if (planLimit === undefined) {
    return { limit: null, planLimit: null, voucherModifier: 0 };
  }

  return {
    limit: Math.max(0, planLimit),
    planLimit,
    voucherModifier: 0,
  };
}

export async function checkPlanAccess(
  systemId: string,
  companyId: string,
  roles: string[],
): Promise<PlanAccessResult> {
  if (roles.includes("superuser")) {
    return { granted: true };
  }

  const core = Core.getInstance();

  // Resolve the tenant row internally to get subscription
  const { fetchCompanySystemTenantRow } = await import("../db/queries/tenants.ts");
  const tenantRow = await fetchCompanySystemTenantRow(companyId, systemId);
  if (!tenantRow) {
    return { granted: false, denyCode: "NO_SUBSCRIPTION" };
  }

  const sub = await core.ensureSubscription(tenantRow.id);
  if (!sub) {
    return { granted: false, denyCode: "NO_SUBSCRIPTION" };
  }

  if (new Date(sub.currentPeriodEnd) < new Date()) {
    return { granted: false, denyCode: "SUBSCRIPTION_EXPIRED" };
  }

  const limits = await getLimits(systemId, companyId);
  const planRoles = limits.roles;

  const hasAccess = planRoles.length === 0 || planRoles.some((r) => roles.includes(r));
  if (!hasAccess) {
    return { granted: false, denyCode: "PLAN_LIMIT" };
  }

  return { granted: true };
}

export async function resolveRateLimitConfig(params: {
  systemId: string;
  companyId: string;
}): Promise<RateLimitConfigResult> {
  const limits = await getLimits(params.systemId, params.companyId);
  return {
    globalLimit: limits.apiRateLimit,
    planRateLimit: limits.apiRateLimit,
    voucherModifier: 0,
  };
}

export async function resolveFileCacheLimit(params: {
  systemId: string;
  companyId: string;
}): Promise<FileCacheLimitResult> {
  const limits = await getLimits(params.systemId, params.companyId);
  const planLimit = limits.fileCacheLimitBytes || 20971520;
  return {
    maxBytes: planLimit,
    planLimit,
    voucherModifier: 0,
  };
}

export async function resolveMaxConcurrentDownloads(params: {
  systemId: string;
  companyId: string;
}): Promise<TransferLimitResult> {
  const limits = await getLimits(params.systemId, params.companyId);
  return {
    max: limits.maxConcurrentDownloads,
    planLimit: limits.maxConcurrentDownloads,
    voucherModifier: 0,
  };
}

export async function resolveMaxConcurrentUploads(params: {
  systemId: string;
  companyId: string;
}): Promise<TransferLimitResult> {
  const limits = await getLimits(params.systemId, params.companyId);
  return {
    max: limits.maxConcurrentUploads,
    planLimit: limits.maxConcurrentUploads,
    voucherModifier: 0,
  };
}

export async function resolveMaxDownloadBandwidth(params: {
  systemId: string;
  companyId: string;
}): Promise<TransferLimitResult> {
  const limits = await getLimits(params.systemId, params.companyId);
  return {
    max: limits.maxDownloadBandwidthMB,
    planLimit: limits.maxDownloadBandwidthMB,
    voucherModifier: 0,
  };
}

export async function resolveMaxUploadBandwidth(params: {
  systemId: string;
  companyId: string;
}): Promise<TransferLimitResult> {
  const limits = await getLimits(params.systemId, params.companyId);
  return {
    max: limits.maxUploadBandwidthMB,
    planLimit: limits.maxUploadBandwidthMB,
    voucherModifier: 0,
  };
}

export async function resolveMaxOperationCount(params: {
  systemId: string;
  companyId: string;
  resourceKey: string;
}): Promise<TransferLimitResult> {
  const limits = await getLimits(params.systemId, params.companyId);
  const planLimit = limits.maxOperationCountByResourceKey[params.resourceKey] ??
    0;
  return {
    max: planLimit,
    planLimit,
    voucherModifier: 0,
  };
}

/**
 * Resolve all operation counts as a merged map for subscription
 * initialization and renewal.
 */
export async function resolveAllOperationCounts(params: {
  systemId: string;
  companyId: string;
}): Promise<Record<string, number>> {
  const limits = await getLimits(params.systemId, params.companyId);
  return limits.maxOperationCountByResourceKey;
}
