import "server-only";

import { get, limitsMerger } from "./cache.ts";
import type { TenantResourceLimits } from "@/src/contracts/high-level/resource-limits";
import type { Tenant } from "@/src/contracts/tenant";
import type {
  EntityLimitResult,
  FileCacheLimitResult,
  PlanAccessResult,
  RateLimitConfigResult,
  TransferLimitResult,
} from "@/src/contracts/high-level/resource-limits";

const EMPTY_LIMITS: TenantResourceLimits = {
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

/** Internal: fetch tenant limits without subscription checks. */
async function getLimits(tenant: Tenant): Promise<TenantResourceLimits> {
  try {
    const limits = await get(
      { systemId: tenant.systemId, companyId: tenant.companyId },
      "limits",
      limitsMerger,
    );
    return (limits as unknown as TenantResourceLimits) ?? EMPTY_LIMITS;
  } catch {
    return EMPTY_LIMITS;
  }
}

export async function resolveEntityLimit(params: {
  tenant: Tenant;
  entityName: string;
}): Promise<EntityLimitResult> {
  const limits = await getLimits(params.tenant);
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
  tenant: Tenant,
  roles: string[],
): Promise<PlanAccessResult> {
  if (roles.includes("superuser")) {
    return { granted: true };
  }

  // Resolve the tenant row internally to get subscription
  const { fetchCompanySystemTenantRow } = await import(
    "../db/queries/tenants.ts"
  );
  const tenantRow = await fetchCompanySystemTenantRow(
    tenant.companyId!,
    tenant.systemId!,
  );
  if (!tenantRow) {
    return { granted: false, denyCode: "NO_SUBSCRIPTION" };
  }

  const sub = await get(
    { systemId: tenant.systemId, companyId: tenant.companyId },
    "subscription",
  ) as unknown as { currentPeriodEnd: string } | undefined;
  if (!sub) {
    return { granted: false, denyCode: "NO_SUBSCRIPTION" };
  }

  if (new Date(sub.currentPeriodEnd) < new Date()) {
    return { granted: false, denyCode: "SUBSCRIPTION_EXPIRED" };
  }

  const limits = await getLimits(tenant);
  // limits.roleIds comes from resolveLimits as role record IDs (e.g. "role:xxx").
  // Resolve them to role names for comparison against TenantContext.roles.
  const planRoleIds: string[] =
    ((limits as unknown as Record<string, unknown>).roleIds as string[]) ??
      limits.roles ??
      [];
  let planRoles: string[];
  if (planRoleIds.length > 0) {
    const coreData = await get(undefined, "core-data") as unknown as {
      roles: { id: string; name: string }[];
    };
    const roleNamesById = new Map(
      (coreData.roles ?? []).map((r) => [String(r.id), r.name]),
    );
    planRoles = planRoleIds
      .map((id) => roleNamesById.get(id) ?? id)
      .filter(Boolean);
  } else {
    planRoles = [];
  }

  const hasAccess = planRoles.length === 0 ||
    planRoles.some((r) => roles.includes(r));
  if (!hasAccess) {
    return { granted: false, denyCode: "PLAN_LIMIT" };
  }

  return { granted: true };
}

export async function resolveRateLimitConfig(
  tenant: Tenant,
): Promise<RateLimitConfigResult> {
  const limits = await getLimits(tenant);
  return {
    globalLimit: limits.apiRateLimit,
    planRateLimit: limits.apiRateLimit,
    voucherModifier: 0,
  };
}

export async function resolveFileCacheLimit(
  tenant: Tenant,
): Promise<FileCacheLimitResult> {
  const limits = await getLimits(tenant);
  const planLimit = limits.fileCacheLimitBytes || 20971520;
  return {
    maxBytes: planLimit,
    planLimit,
    voucherModifier: 0,
  };
}

export async function resolveMaxConcurrentDownloads(
  tenant: Tenant,
): Promise<TransferLimitResult> {
  const limits = await getLimits(tenant);
  return {
    max: limits.maxConcurrentDownloads,
    planLimit: limits.maxConcurrentDownloads,
    voucherModifier: 0,
  };
}

export async function resolveMaxConcurrentUploads(
  tenant: Tenant,
): Promise<TransferLimitResult> {
  const limits = await getLimits(tenant);
  return {
    max: limits.maxConcurrentUploads,
    planLimit: limits.maxConcurrentUploads,
    voucherModifier: 0,
  };
}

export async function resolveMaxDownloadBandwidth(
  tenant: Tenant,
): Promise<TransferLimitResult> {
  const limits = await getLimits(tenant);
  return {
    max: limits.maxDownloadBandwidthMB,
    planLimit: limits.maxDownloadBandwidthMB,
    voucherModifier: 0,
  };
}

export async function resolveMaxUploadBandwidth(
  tenant: Tenant,
): Promise<TransferLimitResult> {
  const limits = await getLimits(tenant);
  return {
    max: limits.maxUploadBandwidthMB,
    planLimit: limits.maxUploadBandwidthMB,
    voucherModifier: 0,
  };
}

export async function resolveMaxOperationCount(params: {
  tenant: Tenant;
  resourceKey: string;
}): Promise<TransferLimitResult> {
  const limits = await getLimits(params.tenant);
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
export async function resolveAllOperationCounts(
  tenant: Tenant,
): Promise<Record<string, number>> {
  const limits = await getLimits(tenant);
  return limits.maxOperationCountByResourceKey;
}
