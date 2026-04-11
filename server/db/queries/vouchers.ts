import { getDb, rid } from "../connection.ts";
import type { Voucher } from "@/src/contracts/voucher";
import type { CursorParams, PaginatedResult } from "@/src/contracts/common";
import { clampPageLimit } from "@/src/lib/validators";

export async function listVouchers(
  params: CursorParams & { search?: string },
): Promise<PaginatedResult<Voucher>> {
  const db = await getDb();
  const limit = clampPageLimit(params.limit);
  const bindings: Record<string, unknown> = { limit: limit + 1 };
  const conditions: string[] = [];

  if (params.search) {
    conditions.push("code CONTAINS $search");
    bindings.search = params.search;
  }
  if (params.cursor) {
    conditions.push(
      params.direction === "prev" ? "id < $cursor" : "id > $cursor",
    );
    bindings.cursor = params.cursor;
  }

  let query = "SELECT * FROM voucher";
  if (conditions.length) query += " WHERE " + conditions.join(" AND ");
  query += " ORDER BY createdAt DESC LIMIT $limit";

  const result = await db.query<[Voucher[]]>(query, bindings);
  const items = result[0] ?? [];
  const hasMore = items.length > limit;
  const data = hasMore ? items.slice(0, limit) : items;

  return {
    data,
    nextCursor: hasMore ? data[data.length - 1]?.id ?? null : null,
    prevCursor: params.cursor ?? null,
  };
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
      expiresAt = $expiresAt`,
    {
      ...data,
      applicableCompanyIds: data.applicableCompanyIds ?? [],
      entityLimitModifiers: hasEntityLimitModifiers
        ? data.entityLimitModifiers
        : undefined,
      apiRateLimitModifier: data.apiRateLimitModifier ?? 0,
      storageLimitModifier: data.storageLimitModifier ?? 0,
      expiresAt: data.expiresAt ?? undefined,
    },
  );
  return result[0][0];
}

export async function deleteVoucher(id: string): Promise<void> {
  const db = await getDb();
  await db.query("DELETE $id", { id: rid(id) });
}
