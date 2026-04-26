import { getDb, rid } from "../connection.ts";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("usage");

export async function getOperationCount(
  tenantId: string,
): Promise<{ resourceKey: string; used: number; max: number }[]> {
  const db = await getDb();
  const result = await db.query<
    [
      { remainingOperationCount: Record<string, number> | null }[],
    ]
  >(
    `SELECT remainingOperationCount FROM subscription
     WHERE tenantIds CONTAINS $tenantId AND status = "active"
     LIMIT 1`,
    {
      tenantId: rid(tenantId),
    },
  );

  const remaining: Record<string, number> =
    (result[0]?.[0]?.remainingOperationCount as Record<string, number>) ?? {};

  const keys = Object.keys(remaining);
  if (keys.length === 0) return [];

  return keys.map((resourceKey) => {
    const max = remaining[resourceKey] ?? 0;
    return {
      resourceKey,
      used: max,
      max,
    };
  });
}

export interface CoreCreditExpenseRow {
  resourceKey: string;
  totalAmount: number;
  totalCount: number;
}

export async function getCoreCreditExpenses(params: {
  startDate: string;
  endDate: string;
  tenantIds?: string[];
  planIds?: string[];
}): Promise<CoreCreditExpenseRow[]> {
  const db = await getDb();
  const conditions: string[] = [
    "day >= $startDate",
    "day <= $endDate",
  ];
  const bindings: Record<string, unknown> = {
    startDate: params.startDate,
    endDate: params.endDate,
  };

  if (params.tenantIds?.length) {
    conditions.push("array::intersects(tenantIds, $tenantIds)");
    bindings.tenantIds = params.tenantIds.map((id) => rid(id));
  }

  if (params.planIds?.length) {
    conditions.push(
      "array::intersects(tenantIds, array::flatten((SELECT VALUE tenantIds FROM subscription WHERE planId IN $planIds AND status = 'active')))",
    );
    bindings.planIds = params.planIds.map((id) => rid(id));
  }

  const where = `WHERE ${conditions.join(" AND ")}`;

  const result = await db.query<[CoreCreditExpenseRow[]]>(
    `SELECT resourceKey, math::sum(amount) AS totalAmount, math::sum(count) AS totalCount
     FROM credit_expense
     ${where}
     GROUP BY resourceKey
     ORDER BY totalAmount DESC`,
    bindings,
  );

  return result[0] ?? [];
}

export interface TenantUsageConfig {
  systemSlug: string | null;
  subscriptionStorageLimit: number | null;
  subscriptionCacheLimit: number | null;
  voucherStorageModifier: number;
  voucherCacheModifier: number;
  creditExpenses: CoreCreditExpenseRow[];
}

/**
 * Upserts a usage record atomically (§2.4).
 * Creates or increments the value for the given tenant + resource + period.
 */
export async function upsertUsageRecord(params: {
  tenantId: string;
  resource: string;
  value: number;
  period: string;
}): Promise<void> {
  const db = await getDb();
  await db.query(
    `UPSERT usage_record SET
      tenantIds = [$tenantId],
      resource = $resource,
      value += $value,
      period = $period
    WHERE tenantIds CONTAINS $tenantId
      AND resource = $resource
      AND period = $period`,
    {
      tenantId: rid(params.tenantId),
      resource: params.resource,
      value: params.value,
      period: params.period,
    },
  );
}

/**
 * Fetches the tenant-mode usage configuration and credit expenses in one
 * batched query: system slug, subscription limits (plan + voucher), and
 * per-resource credit expense aggregation.
 */
export async function getTenantUsageConfig(params: {
  tenantId: string;
  startDate: string;
  endDate: string;
}): Promise<TenantUsageConfig> {
  const db = await getDb();
  const result = await db.query<
    [
      {
        storageLimitBytes: number;
        fileCacheLimitBytes: number;
        voucherId: string | null;
      }[],
      { storageLimitModifier: number; fileCacheLimitModifier: number }[],
      { resourceKey: string; totalAmount: number; totalCount: number }[],
    ]
  >(
    `LET $sub = (SELECT plan.storageLimitBytes AS storageLimitBytes,
       plan.fileCacheLimitBytes AS fileCacheLimitBytes, voucherId
       FROM subscription
       WHERE tenantIds CONTAINS $tenantId AND status = "active"
       LIMIT 1
       FETCH plan);
     LET $voucherId = $sub[0].voucherId;
     IF $voucherId != NONE {
       SELECT storageLimitModifier, fileCacheLimitModifier FROM voucher WHERE id = $voucherId LIMIT 1;
     } ELSE {
       SELECT NONE FROM NONE;
     };
     SELECT resourceKey, math::sum(amount) AS totalAmount, math::sum(count) AS totalCount FROM credit_expense
       WHERE tenantIds CONTAINS $tenantId
         AND day >= $startDate AND day <= $endDate
       GROUP BY resourceKey
       ORDER BY totalAmount DESC`,
    {
      tenantId: rid(params.tenantId),
      startDate: params.startDate,
      endDate: params.endDate,
    },
  );

  const subRow = (result[0] as unknown[])?.[0] as {
    storageLimitBytes?: number;
    fileCacheLimitBytes?: number;
  } | undefined;
  const voucherRow = (result[1]?.[0] as unknown as {
    storageLimitModifier?: number;
    fileCacheLimitModifier?: number;
  }) ?? {};

  return {
    systemSlug: null,
    subscriptionStorageLimit: subRow?.storageLimitBytes ?? null,
    subscriptionCacheLimit: subRow?.fileCacheLimitBytes ?? null,
    voucherStorageModifier: voucherRow.storageLimitModifier ?? 0,
    voucherCacheModifier: voucherRow.fileCacheLimitModifier ?? 0,
    creditExpenses: result[2] ?? [],
  };
}
