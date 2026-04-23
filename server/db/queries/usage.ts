import { getDb, rid } from "../connection.ts";
import type { UsageRecord } from "@/src/contracts/usage";
import { resolveAllOperationCounts } from "@/server/utils/guards";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("usage");

export async function getUsageForPeriod(
  companyId: string,
  systemId: string,
  period?: string,
): Promise<UsageRecord[]> {
  const db = await getDb();
  const currentPeriod = period ?? getCurrentPeriod();

  const result = await db.query<[UsageRecord[]]>(
    `SELECT * FROM usage_record
     WHERE companyId = $companyId AND systemId = $systemId AND period = $period
     ORDER BY resource ASC`,
    { companyId, systemId, period: currentPeriod },
  );
  return result[0] ?? [];
}

export async function getUsageHistory(
  companyId: string,
  systemId: string,
  resource: string,
  periodCount: number = 6,
): Promise<{ period: string; value: number }[]> {
  const db = await getDb();
  const result = await db.query<[{ period: string; value: number }[]]>(
    `SELECT period, math::sum(value) AS value FROM usage_record
     WHERE companyId = $companyId AND systemId = $systemId AND resource = $resource
     GROUP BY period
     ORDER BY period DESC
     LIMIT $limit`,
    { companyId, systemId, resource, limit: periodCount },
  );
  return (result[0] ?? []).reverse();
}

export async function getOperationCount(
  companyId: string,
  systemId: string,
): Promise<{ resourceKey: string; used: number; max: number }[]> {
  const maxMap = await resolveAllOperationCounts({ companyId, systemId });
  const keys = Object.keys(maxMap);

  if (keys.length === 0) return [];

  const db = await getDb();
  const result = await db.query<
    [{ remainingOperationCount: Record<string, number> | null }[]]
  >(
    `SELECT remainingOperationCount FROM subscription
     WHERE companyId = $companyId AND systemId = $systemId AND status = "active"
     LIMIT 1`,
    {
      companyId: rid(companyId),
      systemId: rid(systemId),
    },
  );

  const remaining: Record<string, number> =
    (result[0]?.[0]?.remainingOperationCount as Record<string, number>) ?? {};

  return keys.map((resourceKey) => {
    const max = maxMap[resourceKey];
    const rem = remaining[resourceKey] ?? 0;
    return {
      resourceKey,
      used: Math.max(0, max - rem),
      max,
    };
  });
}

function getCurrentPeriod(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export interface CoreCreditExpenseRow {
  resourceKey: string;
  totalAmount: number;
  totalCount: number;
}

export async function getCoreCreditExpenses(params: {
  startDate: string;
  endDate: string;
  companyIds?: string[];
  systemIds?: string[];
  planIds?: string[];
  actorIds?: string[];
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

  if (params.companyIds?.length) {
    conditions.push("companyId IN $companyIds");
    bindings.companyIds = params.companyIds.map((id) => rid(id));
  }

  if (params.systemIds?.length) {
    conditions.push("systemId IN $systemIds");
    bindings.systemIds = params.systemIds.map((id) => rid(id));
  }

  if (params.planIds?.length) {
    conditions.push(
      "companyId IN (SELECT VALUE companyId FROM subscription WHERE planId IN $planIds AND status = 'active')",
    );
    bindings.planIds = params.planIds.map((id) => rid(id));
  }

  if (params.actorIds?.length) {
    conditions.push("actorId IN $actorIds");
    bindings.actorIds = params.actorIds;
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
 * Fetches the tenant-mode usage configuration and credit expenses in one
 * batched query: system slug, subscription limits (plan + voucher), and
 * per-resource credit expense aggregation.
 */
/**
 * Upserts a usage record atomically (§12.2).
 * Creates or increments the value for the given actor + resource + period.
 */
export async function upsertUsageRecord(params: {
  actorType: string;
  actorId: string;
  companyId: string;
  systemId: string;
  resource: string;
  value: number;
  period: string;
}): Promise<void> {
  const db = await getDb();
  await db.query(
    `UPSERT usage_record SET
      actorType = $actorType,
      actorId = $actorId,
      companyId = $companyId,
      systemId = $systemId,
      resource = $resource,
      value += $value,
      period = $period
    WHERE actorType = $actorType
      AND actorId = $actorId
      AND companyId = $companyId
      AND systemId = $systemId
      AND resource = $resource
      AND period = $period`,
    {
      actorType: params.actorType,
      actorId: params.actorId,
      companyId: rid(params.companyId),
      systemId: rid(params.systemId),
      resource: params.resource,
      value: params.value,
      period: params.period,
    },
  );
}

export async function getTenantUsageConfig(params: {
  systemId: string;
  companyId: string;
  startDate: string;
  endDate: string;
}): Promise<TenantUsageConfig> {
  const db = await getDb();
  const result = await db.query<
    [
      { slug: string }[],
      {
        storageLimitBytes: number;
        fileCacheLimitBytes: number;
        voucherId: string | null;
      }[],
      { storageLimitModifier: number; fileCacheLimitModifier: number }[],
      { resourceKey: string; totalAmount: number; totalCount: number }[],
    ]
  >(
    `SELECT slug FROM ONLY $systemId;
     SELECT plan.storageLimitBytes AS storageLimitBytes, plan.fileCacheLimitBytes AS fileCacheLimitBytes, voucherId
       FROM subscription
       WHERE companyId = $companyId AND systemId = $systemId AND status = "active"
       LIMIT 1
       FETCH plan;
     LET $voucherId = (SELECT VALUE voucherId FROM subscription
       WHERE companyId = $companyId AND systemId = $systemId AND status = "active"
       LIMIT 1)[0];
     IF $voucherId != NONE {
       SELECT storageLimitModifier, fileCacheLimitModifier FROM voucher WHERE id = $voucherId LIMIT 1;
     } ELSE {
       SELECT NONE FROM NONE;
     };
     SELECT resourceKey, math::sum(amount) AS totalAmount, math::sum(count) AS totalCount FROM credit_expense
       WHERE companyId = $companyId AND systemId = $systemId
         AND day >= $startDate AND day <= $endDate
       GROUP BY resourceKey
       ORDER BY totalAmount DESC`,
    {
      systemId: rid(params.systemId),
      companyId: rid(params.companyId),
      startDate: params.startDate,
      endDate: params.endDate,
    },
  );

  const systemSlug = (result[0] as unknown as { slug?: string }[])
    ?.[0]?.slug ?? null;
  const subRow = (result[1] as unknown[])?.[0] as {
    storageLimitBytes?: number;
    fileCacheLimitBytes?: number;
  } | undefined;
  const voucherRow = (result[2]?.[0] as unknown as {
    storageLimitModifier?: number;
    fileCacheLimitModifier?: number;
  }) ?? {};

  return {
    systemSlug,
    subscriptionStorageLimit: subRow?.storageLimitBytes ?? null,
    subscriptionCacheLimit: subRow?.fileCacheLimitBytes ?? null,
    voucherStorageModifier: voucherRow.storageLimitModifier ?? 0,
    voucherCacheModifier: voucherRow.fileCacheLimitModifier ?? 0,
    creditExpenses: result[3] ?? [],
  };
}
