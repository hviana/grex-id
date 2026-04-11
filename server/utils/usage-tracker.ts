import { getDb } from "../db/connection";

if (typeof window !== "undefined") {
  throw new Error("usage-tracker.ts must not be imported in client-side code.");
}

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
  const db = await getDb();
  const period = getCurrentPeriod();

  // Single-call rule: use UPSERT to atomically create or increment
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
    { ...params, period },
  );
}
