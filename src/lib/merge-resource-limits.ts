import type { ResourceLimitsData } from "@/src/contracts/high-level/resource-limits";

/**
 * Merges a base ResourceLimitsData (plan) with a voucher's ResourceLimitsData.
 * Voucher roleIds are additive (union). All other numeric fields are summed.
 * Strings/benefits are concatenated. Maps are merged key-by-key (summed).
 * priceModifier is summed.
 */
export function mergeResourceLimits(
  base: ResourceLimitsData | null | undefined,
  voucher: ResourceLimitsData | null | undefined,
): ResourceLimitsData {
  if (!base && !voucher) return {};
  if (!voucher) return base ?? {};
  if (!base) return voucher;

  const mergeNum = (
    a: number | null | undefined,
    b: number | null | undefined,
  ): number | undefined => {
    const av = a ?? undefined;
    const bv = b ?? undefined;
    if (av == null && bv == null) return undefined;
    if (bv == null) return av;
    if (av == null) return bv;
    return Math.max(0, av + bv);
  };

  const mergeMap = (
    a: Record<string, number> | null | undefined,
    b: Record<string, number> | null | undefined,
  ): Record<string, number> | undefined => {
    if (!a && !b) return undefined;
    const result: Record<string, number> = {};
    const aObj: Record<string, number> = a ?? {};
    const bObj: Record<string, number> = b ?? {};
    const keys = new Set([...Object.keys(aObj), ...Object.keys(bObj)]);
    for (const key of keys) {
      const p = aObj[key];
      const v = bObj[key];
      if (p == null && v == null) continue;
      if (v == null) {
        result[key] = p;
        continue;
      }
      if (p == null) {
        result[key] = v;
        continue;
      }
      result[key] = Math.max(0, p + v);
    }
    return Object.keys(result).length > 0 ? result : undefined;
  };

  const mergeStrings = (
    a: string[] | null | undefined,
    b: string[] | null | undefined,
  ): string[] | undefined => {
    const aa = Array.isArray(a) ? a : [];
    const bb = Array.isArray(b) ? b : [];
    const merged = [...aa, ...bb];
    return merged.length > 0 ? merged : undefined;
  };

  return {
    benefits: mergeStrings(base.benefits, voucher.benefits),
    roleIds: mergeStrings(base.roleIds, voucher.roleIds),
    entityLimits: mergeMap(base.entityLimits, voucher.entityLimits),
    apiRateLimit: mergeNum(base.apiRateLimit, voucher.apiRateLimit),
    storageLimitBytes: mergeNum(
      base.storageLimitBytes,
      voucher.storageLimitBytes,
    ),
    fileCacheLimitBytes: mergeNum(
      base.fileCacheLimitBytes,
      voucher.fileCacheLimitBytes,
    ),
    credits: mergeNum(base.credits, voucher.credits),
    maxConcurrentDownloads: mergeNum(
      base.maxConcurrentDownloads,
      voucher.maxConcurrentDownloads,
    ),
    maxConcurrentUploads: mergeNum(
      base.maxConcurrentUploads,
      voucher.maxConcurrentUploads,
    ),
    maxDownloadBandwidthMB: mergeNum(
      base.maxDownloadBandwidthMB,
      voucher.maxDownloadBandwidthMB,
    ),
    maxUploadBandwidthMB: mergeNum(
      base.maxUploadBandwidthMB,
      voucher.maxUploadBandwidthMB,
    ),
    maxOperationCountByResourceKey: mergeMap(
      base.maxOperationCountByResourceKey,
      voucher.maxOperationCountByResourceKey,
    ),
    creditLimitByResourceKey: mergeMap(
      base.creditLimitByResourceKey,
      voucher.creditLimitByResourceKey,
    ),
    priceModifier: mergeNum(base.priceModifier, voucher.priceModifier),
    frontendDomains: mergeStrings(
      base.frontendDomains,
      voucher.frontendDomains,
    ),
  };
}

/**
 * Computes the effective price given a base price and voucher priceModifier.
 */
export function effectivePrice(
  basePrice: number,
  priceModifier?: number | null,
): number {
  return Math.max(0, basePrice + (priceModifier ?? 0));
}
