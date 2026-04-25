import { getDb, rid } from "../connection.ts";
import type { Voucher } from "@/src/contracts/voucher";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("vouchers");

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
  applicableCompanies: string[];
  applicablePlans: string[];
  priceModifier: number;
  permissions: string[];
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
      applicableCompanies = $applicableCompanies,
      applicablePlans = $applicablePlans,
      priceModifier = $priceModifier,
      permissions = $permissions,
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
      applicableCompanies: data.applicableCompanies ?? [],
      applicablePlans: data.applicablePlans ?? [],
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
 * If applicablePlans is non-empty after the update, clears voucherId
 * on any subscription whose planId is NOT in the new list.
 * If applicableCompanies is non-empty, clears voucherId on subscriptions
 * whose companyId is NOT in the new list.
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
         AND planId NOT IN $applicablePlans`,
    );
  }
  if (shouldCascadeCompanies) {
    cascadeParts.push(
      `UPDATE subscription SET voucherId = NONE
       WHERE voucherId = $id
         AND companyId NOT IN $applicableCompanies`,
    );
  }

  const cascadeQuery = cascadeParts.length > 0
    ? `;${cascadeParts.join(";")}`
    : "";

  const result = await db.query<[Voucher[]]>(
    `UPDATE $id SET ${sets.join(", ")} RETURN AFTER${cascadeQuery}`,
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
