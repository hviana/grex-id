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
  actorType: "user" | "token" | "connected_app";
  actorId: string;
  companyId: string;
  systemId: string;
  resource: string;
  value: number;
}): Promise<void> {
  const period = getCurrentPeriod();

  await upsertUsageRecord({
    actorType: params.actorType,
    actorId: params.actorId,
    companyId: params.companyId,
    systemId: params.systemId,
    resource: params.resource,
    value: params.value,
    period,
  });
}
