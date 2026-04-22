import { getDb, rid } from "../connection.ts";
import type { Voucher } from "@/src/contracts/voucher";
import type { CursorParams, PaginatedResult } from "@/src/contracts/common";
import { paginatedQuery } from "./pagination.ts";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("vouchers");

export async function listVouchers(
  params: CursorParams & { search?: string },
): Promise<PaginatedResult<Voucher>> {
  const conditions: string[] = [];
  const bindings: Record<string, unknown> = {};

  if (params.search) {
    conditions.push("code CONTAINS $search");
    bindings.search = params.search;
  }

  return paginatedQuery<Voucher>({
    table: "voucher",
    conditions,
    bindings,
    params,
  });
}

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
  maxOperationCountModifier?: number;
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
      applicableCompanyIds: data.applicableCompanyIds ?? [],
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
      maxOperationCountModifier: data.maxOperationCountModifier ?? 0,
      creditModifier: data.creditModifier ?? 0,
      expiresAt: data.expiresAt ?? undefined,
    },
  );
  return result[0][0];
}

export async function deleteVoucher(id: string): Promise<void> {
  const db = await getDb();
  await db.query("DELETE $id", { id: rid(id) });
}
