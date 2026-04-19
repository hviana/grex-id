import { getDb, rid } from "../connection.ts";
import type { UsageRecord } from "@/src/contracts/usage";
import { resolveMaxOperationCount } from "@/server/utils/guards";

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
): Promise<{ used: number; max: number }> {
  const cap = await resolveMaxOperationCount({ companyId, systemId });
  const max = cap.max;

  if (max <= 0) {
    return { used: 0, max: 0 };
  }

  const db = await getDb();
  const result = await db.query<[{ remainingOperationCount: number }[]]>(
    `SELECT VALUE remainingOperationCount FROM subscription
     WHERE companyId = $companyId AND systemId = $systemId AND status = "active"
     LIMIT 1`,
    {
      companyId: rid(companyId),
      systemId: rid(systemId),
    },
  );

  const remaining =
    (result[0] as unknown as { remainingOperationCount?: number }[])
      ?.[0]?.remainingOperationCount ?? 0;
  const used = Math.max(0, max - remaining);

  return { used, max };
}

function getCurrentPeriod(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}
