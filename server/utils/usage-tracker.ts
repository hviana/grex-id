import { upsertUsageRecord } from "../db/queries/usage.ts";
import { assertServerOnly } from "./server-only.ts";

assertServerOnly("usage-tracker.ts");

function getCurrentPeriod(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export async function trackUsage(params: {
  tenantId: string;
  resourceKey: string;
  value: number;
}): Promise<void> {
  const period = getCurrentPeriod();
  await upsertUsageRecord({
    tenantId: params.tenantId,
    resourceKey: params.resourceKey,
    value: params.value,
    period,
  });
}
