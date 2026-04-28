import { getDb, rid } from "../connection.ts";
import type { Voucher } from "@/src/contracts/voucher";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("vouchers");

/**
 * Creates a resource_limit AND a voucher in one batched query (§2.4).
 * Returns the created voucher with resourceLimitId fetched.
 */
export async function createVoucherWithResourceLimit(data: {
  name: string;
  applicableTenantIds: string[];
  applicablePlanIds: string[];
  expiresAt?: Date;
  resourceLimits?: Record<string, unknown>;
}): Promise<Voucher | null> {
  const db = await getDb();
  const rl = data.resourceLimits ?? {};

  const result = await db.query<[unknown, unknown, Voucher[]]>(
    `LET $rl = CREATE resource_limit SET
      benefits = $benefits,
      roleIds = $roleIds,
      entityLimits = $entityLimits,
      apiRateLimit = $apiRateLimit,
      storageLimitBytes = $storageLimitBytes,
      fileCacheLimitBytes = $fileCacheLimitBytes,
      credits = $credits,
      maxConcurrentDownloads = $maxConcurrentDownloads,
      maxConcurrentUploads = $maxConcurrentUploads,
      maxDownloadBandwidthMB = $maxDownloadBandwidthMB,
      maxUploadBandwidthMB = $maxUploadBandwidthMB,
      maxOperationCountByResourceKey = $maxOperationCountByResourceKey,
      creditLimitByResourceKey = $creditLimitByResourceKey,
      frontendDomains = $frontendDomains;
    LET $v = CREATE voucher SET
      name = $name,
      applicableTenantIds = $applicableTenantIds,
      applicablePlanIds = $applicablePlanIds,
      resourceLimitId = $rl[0].id,
      expiresAt = $expiresAt;
    SELECT * FROM $v[0].id FETCH resourceLimitId;`,
    {
      name: data.name,
      applicableTenantIds: data.applicableTenantIds.map((id) => rid(id)),
      applicablePlanIds: data.applicablePlanIds.map((id) => rid(id)),
      expiresAt: data.expiresAt ?? undefined,
      benefits: (rl.benefits as string[]) ?? [],
      roleIds: (rl.roleIds as string[]) ?? [],
      entityLimits: rl.entityLimits ?? undefined,
      apiRateLimit: Number(rl.apiRateLimit ?? 0),
      storageLimitBytes: Number(rl.storageLimitBytes ?? 0),
      fileCacheLimitBytes: Number(rl.fileCacheLimitBytes ?? 0),
      credits: Number(rl.credits ?? 0),
      maxConcurrentDownloads: Number(rl.maxConcurrentDownloads ?? 0),
      maxConcurrentUploads: Number(rl.maxConcurrentUploads ?? 0),
      maxDownloadBandwidthMB: Number(rl.maxDownloadBandwidthMB ?? 0),
      maxUploadBandwidthMB: Number(rl.maxUploadBandwidthMB ?? 0),
      maxOperationCountByResourceKey: rl.maxOperationCountByResourceKey ??
        undefined,
      creditLimitByResourceKey: rl.creditLimitByResourceKey ?? undefined,
      frontendDomains: (rl.frontendDomains as string[]) ?? [],
    },
  );

  return result[2]?.[0] ?? null;
}

/**
 * Updates a voucher and its linked resource_limit in one batched query
 * with auto-removal cascade (§7.7).
 */
export async function updateVoucherWithCascade(
  id: string,
  voucherSets: string[],
  rlSets: string[],
  bindings: Record<string, unknown>,
  shouldCascadePlans: boolean,
  shouldCascadeTenants: boolean,
): Promise<Voucher | null> {
  if (voucherSets.length === 0 && rlSets.length === 0) return null;

  const db = await getDb();
  bindings.id = rid(String(id));

  const cascadeParts: string[] = [];
  if (shouldCascadePlans) {
    cascadeParts.push(
      `UPDATE subscription SET voucherId = NONE
       WHERE voucherId = $id
         AND planId NOT IN $applicablePlanIds;`,
    );
  }
  if (shouldCascadeTenants) {
    cascadeParts.push(
      `UPDATE subscription SET voucherId = NONE
       WHERE voucherId = $id
         AND tenantIds NONEINSIDE $applicableTenantIds;`,
    );
  }

  const voucherUpdate = voucherSets.length > 0
    ? `UPDATE $id SET ${voucherSets.join(", ")}`
    : "";
  const rlUpdate = rlSets.length > 0
    ? `LET $rl = $id.resourceLimitId; UPDATE $rl SET ${rlSets.join(", ")}`
    : "";

  const hasPreceding = voucherUpdate || rlUpdate || cascadeParts.length > 0;
  const result = await db.query<[Voucher[]]>(
    `${voucherUpdate}${voucherUpdate && rlUpdate ? ";" : ""}${rlUpdate}${
      cascadeParts.join("")
    }${hasPreceding ? ";" : ""}SELECT * FROM $id FETCH resourceLimitId;`,
    bindings,
  );

  // Last query result is the SELECT
  const lastIdx = result.length - 1;
  return result[lastIdx]?.[0] ?? null;
}

/**
 * Removes voucher reference from subscriptions and deletes the voucher
 * in one batched query.
 */
export async function deleteVoucher(id: string): Promise<void> {
  const db = await getDb();
  await db.query(
    `UPDATE subscription SET voucherId = NONE WHERE voucherId = $id;
     DELETE $id;`,
    { id: rid(id) },
  );
}
