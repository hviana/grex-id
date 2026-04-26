import Core from "./Core.ts";
import type { Tenant } from "@/src/contracts/tenant.ts";
import type { Subscription } from "@/src/contracts/billing.ts";
import type { Plan } from "@/src/contracts/plan.ts";
import type { Voucher } from "@/src/contracts/voucher.ts";
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

async function resolveSubscription(
  tenantId: string,
): Promise<Subscription | null> {
  const core = Core.getInstance();
  return core.ensureSubscription(tenantId);
}

async function resolvePlan(planId: string): Promise<Plan | undefined> {
  return Core.getInstance().getPlanById(planId);
}

async function resolveVoucher(
  voucherId: string | undefined,
): Promise<Voucher | undefined> {
  if (!voucherId) return undefined;
  return Core.getInstance().getVoucherById(voucherId);
}

export async function resolveEntityLimit(params: {
  tenant: Tenant;
  entityName: string;
}): Promise<EntityLimitResult> {
  const sub = await resolveSubscription(params.tenant.id);
  if (!sub) {
    return { limit: null, planLimit: null, voucherModifier: 0 };
  }

  const plan = await resolvePlan(sub.planId);
  if (!plan?.entityLimits?.[params.entityName]) {
    return { limit: null, planLimit: null, voucherModifier: 0 };
  }

  const planLimit = plan.entityLimits[params.entityName];
  let voucherModifier = 0;

  if (sub.voucherId) {
    const voucher = await resolveVoucher(sub.voucherId);
    if (voucher?.entityLimitModifiers?.[params.entityName]) {
      voucherModifier = voucher.entityLimitModifiers[params.entityName];
    }
  }

  return {
    limit: Math.max(0, planLimit + voucherModifier),
    planLimit,
    voucherModifier,
  };
}

export async function checkPlanAccess(
  tenant: Tenant,
  roleNames: string[],
): Promise<PlanAccessResult> {
  if (tenant.roles.includes("superuser")) {
    return { granted: true };
  }

  const sub = await resolveSubscription(tenant.id);
  if (!sub) {
    return { granted: false, denyCode: "NO_SUBSCRIPTION" };
  }

  if (new Date(sub.currentPeriodEnd) < new Date()) {
    return { granted: false, denyCode: "SUBSCRIPTION_EXPIRED" };
  }

  const plan = await resolvePlan(sub.planId);
  if (!plan) {
    return { granted: false, denyCode: "NO_SUBSCRIPTION" };
  }

  // Check if the plan grants any of the required roles
  const hasAccess = roleNames.some((r) => plan.roles.includes(r));
  if (!hasAccess) {
    return { granted: false, denyCode: "PLAN_LIMIT" };
  }

  return { granted: true };
}

export async function resolveRateLimitConfig(params: {
  tenant: Tenant;
}): Promise<RateLimitConfigResult> {
  const sub = await resolveSubscription(params.tenant.id);
  if (!sub) {
    return { globalLimit: 0, planRateLimit: 0, voucherModifier: 0 };
  }

  const plan = await resolvePlan(sub.planId);
  const planRateLimit = plan?.apiRateLimit ?? 0;

  let voucherModifier = 0;
  if (sub.voucherId) {
    const voucher = await resolveVoucher(sub.voucherId);
    voucherModifier = voucher?.apiRateLimitModifier ?? 0;
  }

  return {
    globalLimit: Math.max(0, planRateLimit + voucherModifier),
    planRateLimit,
    voucherModifier,
  };
}

export async function resolveFileCacheLimit(params: {
  tenant: Tenant;
}): Promise<FileCacheLimitResult> {
  const sub = await resolveSubscription(params.tenant.id);
  if (!sub) {
    return { maxBytes: 0, planLimit: 0, voucherModifier: 0 };
  }

  const plan = await resolvePlan(sub.planId);
  const planLimit = plan?.fileCacheLimitBytes ?? 20971520;

  let voucherModifier = 0;
  if (sub.voucherId) {
    const voucher = await resolveVoucher(sub.voucherId);
    voucherModifier = voucher?.fileCacheLimitModifier ?? 0;
  }

  return {
    maxBytes: Math.max(0, planLimit + voucherModifier),
    planLimit,
    voucherModifier,
  };
}

export async function resolveMaxConcurrentDownloads(params: {
  tenant: Tenant;
}): Promise<TransferLimitResult> {
  const sub = await resolveSubscription(params.tenant.id);
  if (!sub) return { max: 0, planLimit: 0, voucherModifier: 0 };

  const plan = await resolvePlan(sub.planId);
  const planLimit = plan?.maxConcurrentDownloads ?? 0;

  let voucherModifier = 0;
  if (sub.voucherId) {
    const voucher = await resolveVoucher(sub.voucherId);
    voucherModifier = voucher?.maxConcurrentDownloadsModifier ?? 0;
  }

  return {
    max: Math.max(0, planLimit + voucherModifier),
    planLimit,
    voucherModifier,
  };
}

export async function resolveMaxConcurrentUploads(params: {
  tenant: Tenant;
}): Promise<TransferLimitResult> {
  const sub = await resolveSubscription(params.tenant.id);
  if (!sub) return { max: 0, planLimit: 0, voucherModifier: 0 };

  const plan = await resolvePlan(sub.planId);
  const planLimit = plan?.maxConcurrentUploads ?? 0;

  let voucherModifier = 0;
  if (sub.voucherId) {
    const voucher = await resolveVoucher(sub.voucherId);
    voucherModifier = voucher?.maxConcurrentUploadsModifier ?? 0;
  }

  return {
    max: Math.max(0, planLimit + voucherModifier),
    planLimit,
    voucherModifier,
  };
}

export async function resolveMaxDownloadBandwidth(params: {
  tenant: Tenant;
}): Promise<TransferLimitResult> {
  const sub = await resolveSubscription(params.tenant.id);
  if (!sub) return { max: 0, planLimit: 0, voucherModifier: 0 };

  const plan = await resolvePlan(sub.planId);
  const planLimit = plan?.maxDownloadBandwidthMB ?? 0;

  let voucherModifier = 0;
  if (sub.voucherId) {
    const voucher = await resolveVoucher(sub.voucherId);
    voucherModifier = voucher?.maxDownloadBandwidthModifier ?? 0;
  }

  return {
    max: Math.max(0, planLimit + voucherModifier),
    planLimit,
    voucherModifier,
  };
}

export async function resolveMaxUploadBandwidth(params: {
  tenant: Tenant;
}): Promise<TransferLimitResult> {
  const sub = await resolveSubscription(params.tenant.id);
  if (!sub) return { max: 0, planLimit: 0, voucherModifier: 0 };

  const plan = await resolvePlan(sub.planId);
  const planLimit = plan?.maxUploadBandwidthMB ?? 0;

  let voucherModifier = 0;
  if (sub.voucherId) {
    const voucher = await resolveVoucher(sub.voucherId);
    voucherModifier = voucher?.maxUploadBandwidthModifier ?? 0;
  }

  return {
    max: Math.max(0, planLimit + voucherModifier),
    planLimit,
    voucherModifier,
  };
}

export async function resolveMaxOperationCount(params: {
  tenant: Tenant;
  resourceKey: string;
}): Promise<TransferLimitResult> {
  const sub = await resolveSubscription(params.tenant.id);
  if (!sub) return { max: 0, planLimit: 0, voucherModifier: 0 };

  const plan = await resolvePlan(sub.planId);
  const planLimit = plan?.maxOperationCount?.[params.resourceKey] ?? 0;

  let voucherModifier = 0;
  if (sub.voucherId) {
    const voucher = await resolveVoucher(sub.voucherId);
    voucherModifier =
      voucher?.maxOperationCountModifier?.[params.resourceKey] ?? 0;
  }

  return {
    max: Math.max(0, planLimit + voucherModifier),
    planLimit,
    voucherModifier,
  };
}

/**
 * Resolve all operation counts as a merged map (plan + voucher) for
 * subscription initialization and renewal.
 */
export async function resolveAllOperationCounts(params: {
  tenant: Tenant;
}): Promise<Record<string, number>> {
  const sub = await resolveSubscription(params.tenant.id);
  if (!sub) return {};

  const plan = await resolvePlan(sub.planId);
  const planMap = plan?.maxOperationCount ?? {};

  let voucherMap: Record<string, number> = {};
  if (sub.voucherId) {
    const voucher = await resolveVoucher(sub.voucherId);
    voucherMap = voucher?.maxOperationCountModifier ?? {};
  }

  const allKeys = new Set([
    ...Object.keys(planMap),
    ...Object.keys(voucherMap),
  ]);

  const result: Record<string, number> = {};
  for (const key of allKeys) {
    const planVal = planMap[key] ?? 0;
    const voucherVal = voucherMap[key] ?? 0;
    const effective = Math.max(0, planVal + voucherVal);
    if (effective > 0) {
      result[key] = effective;
    }
  }

  return result;
}
