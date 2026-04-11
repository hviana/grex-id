import { getDb } from "../connection.ts";
import type { UsageRecord } from "@/src/contracts/usage";

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

function getCurrentPeriod(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}
