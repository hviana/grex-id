import { getDb, rid } from "../connection.ts";
import type { Voucher } from "@/src/contracts/voucher";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("vouchers");

/**
 * Voucher has no `permissions` field. Voucher modifiers are signed
 * integers/objects per §7.7.
 */
export async function findVoucherByCode(code: string): Promise<Voucher | null> {
  const db = await getDb();
  const result = await db.query<[Voucher[]]>(
    "SELECT * FROM voucher WHERE code = $code LIMIT 1",
    { code },
  );
  return result[0]?.[0] ?? null;
}

export async function createVoucher(data: {
  code: string;
  applicableCompanyIds: string[];
  applicablePlanIds: string[];
  priceModifier: number;
  entityLimitModifiers?: Record<string, number>;
  apiRateLimitModifier?: number;
  storageLimitModifier?: number;
  fileCacheLimitModifier?: number;
  maxConcurrentDownloadsModifier?: number;
  maxConcurrentUploadsModifier?: number;
  maxDownloadBandwidthModifier?: number;
  maxUploadBandwidthModifier?: number;
  maxOperationCountModifier?: Record<string, number>;
  creditModifier?: number;
  expiresAt?: string;
}): Promise<Voucher> {
  const db = await getDb();
  const hasEntityLimitModifiers = data.entityLimitModifiers &&
    Object.keys(data.entityLimitModifiers).length > 0;
  const result = await db.query<[Voucher[]]>(
    `CREATE voucher SET
      code = $code,
      applicableCompanyIds = $applicableCompanyIds,
      applicablePlanIds = $applicablePlanIds,
      priceModifier = $priceModifier,
      ${
      hasEntityLimitModifiers
        ? "entityLimitModifiers = $entityLimitModifiers,"
        : ""
    }
      apiRateLimitModifier = $apiRateLimitModifier,
      storageLimitModifier = $storageLimitModifier,
      fileCacheLimitModifier = $fileCacheLimitModifier,
      maxConcurrentDownloadsModifier = $maxConcurrentDownloadsModifier,
      maxConcurrentUploadsModifier = $maxConcurrentUploadsModifier,
      maxDownloadBandwidthModifier = $maxDownloadBandwidthModifier,
      maxUploadBandwidthModifier = $maxUploadBandwidthModifier,
      maxOperationCountModifier = $maxOperationCountModifier,
      creditModifier = $creditModifier,
      expiresAt = $expiresAt`,
    {
      ...data,
      applicableCompanyIds: data.applicableCompanyIds ?? [],
      applicablePlanIds: data.applicablePlanIds ?? [],
      entityLimitModifiers: hasEntityLimitModifiers
        ? data.entityLimitModifiers
        : undefined,
      apiRateLimitModifier: data.apiRateLimitModifier ?? 0,
      storageLimitModifier: data.storageLimitModifier ?? 0,
      fileCacheLimitModifier: data.fileCacheLimitModifier ?? 0,
      maxConcurrentDownloadsModifier: data.maxConcurrentDownloadsModifier ?? 0,
      maxConcurrentUploadsModifier: data.maxConcurrentUploadsModifier ?? 0,
      maxDownloadBandwidthModifier: data.maxDownloadBandwidthModifier ?? 0,
      maxUploadBandwidthModifier: data.maxUploadBandwidthModifier ?? 0,
      maxOperationCountModifier: data.maxOperationCountModifier || undefined,
      creditModifier: data.creditModifier ?? 0,
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
    },
  );
  return result[0][0];
}

/**
 * Updates a voucher with auto-removal cascade (§7.7).
 * If applicablePlanIds is non-empty after the update, clears voucherId
 * on any subscription whose planId is NOT in the new list.
 * If applicableCompanyIds is non-empty after the update, clears voucherId
 * on any subscription whose companyId is NOT in the new list.
 * All operations run in one batched query.
 */
export async function updateVoucherWithCascade(
  id: string,
  sets: string[],
  bindings: Record<string, unknown>,
  shouldCascadePlans: boolean,
  shouldCascadeCompanies: boolean,
): Promise<Voucher | null> {
  if (sets.length === 0) return null;

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
  if (shouldCascadeCompanies) {
    cascadeParts.push(
      `UPDATE subscription SET voucherId = NONE
       WHERE voucherId = $id
         AND companyId NOT IN $applicableCompanyIds;`,
    );
  }

  const result = await db.query<[Voucher[]]>(
    `UPDATE $id SET ${sets.join(", ")} RETURN AFTER;${cascadeParts.join("")}`,
    bindings,
  );
  return result[0]?.[0] ?? null;
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
