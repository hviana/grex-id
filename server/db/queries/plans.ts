import { getDb, rid } from "../connection.ts";
import type { Plan } from "@/src/contracts/plan";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("plans");

/**
 * Creates a resource_limit AND a plan in one batched query (§2.4).
 * Returns the created plan with resourceLimitId fetched.
 */
export async function createPlanWithResourceLimit(data: {
  name: string;
  description?: string;
  tenantId: string;
  price: number;
  currency: string;
  recurrenceDays: number;
  isActive: boolean;
  resourceLimits?: Record<string, unknown>;
}): Promise<Plan | null> {
  const db = await getDb();
  const rl = data.resourceLimits ?? {};

  const rlFields: string[] = [];
  const bindings: Record<string, unknown> = {
    name: data.name,
    description: data.description ?? "",
    tenantId: rid(data.tenantId),
    price: data.price,
    currency: data.currency,
    recurrenceDays: data.recurrenceDays,
    isActive: data.isActive,
  };

  const setIf = (field: string, value: unknown) => {
    if (value !== undefined && value !== null) {
      rlFields.push(`${field} = $${field}`);
      bindings[field] = value;
    }
  };

  const setArrayIf = (field: string, value: unknown) => {
    const arr = value as unknown[];
    if (arr && arr.length > 0) {
      rlFields.push(`${field} = $${field}`);
      bindings[field] = value;
    }
  };

  setArrayIf("benefits", rl.benefits);
  setArrayIf("roleIds", rl.roleIds);
  setIf("entityLimits", rl.entityLimits);
  setIf("apiRateLimit", Number(rl.apiRateLimit ?? 0));
  setIf("storageLimitBytes", Number(rl.storageLimitBytes ?? 0));
  setIf("fileCacheLimitBytes", Number(rl.fileCacheLimitBytes ?? 0));
  setIf("credits", Number(rl.credits ?? 0));
  setIf("maxConcurrentDownloads", Number(rl.maxConcurrentDownloads ?? 0));
  setIf("maxConcurrentUploads", Number(rl.maxConcurrentUploads ?? 0));
  setIf("maxDownloadBandwidthMB", Number(rl.maxDownloadBandwidthMB ?? 0));
  setIf("maxUploadBandwidthMB", Number(rl.maxUploadBandwidthMB ?? 0));
  setIf("maxOperationCountByResourceKey", rl.maxOperationCountByResourceKey);
  setIf("creditLimitByResourceKey", rl.creditLimitByResourceKey);
  setArrayIf("frontendDomains", rl.frontendDomains);

  const result = await db.query<[unknown, unknown, Plan[]]>(
    `LET $rl = CREATE resource_limit SET
      ${rlFields.join(",\n      ")};
    LET $p = CREATE plan SET
      name = $name,
      description = $description,
      price = $price,
      currency = $currency,
      recurrenceDays = $recurrenceDays,
      isActive = $isActive,
      resourceLimitId = $rl[0].id,
      tenantIds = {$tenantId,};
    SELECT * FROM $p[0].id FETCH resourceLimitId;`,
    bindings,
  );

  return result[2]?.[0] ?? null;
}

/**
 * Updates a plan and its linked resource_limit in one batched query.
 */
export async function updatePlanWithResourceLimit(
  id: string,
  planSets: string[],
  rlSets: string[],
  bindings: Record<string, unknown>,
): Promise<Plan | null> {
  if (planSets.length === 0 && rlSets.length === 0) return null;

  const db = await getDb();
  bindings.id = rid(String(id));

  const planUpdate = planSets.length > 0
    ? `UPDATE $id SET ${planSets.join(", ")}`
    : "";
  const rlUpdate = rlSets.length > 0
    ? `LET $rl = $id.resourceLimitId; UPDATE $rl SET ${rlSets.join(", ")}`
    : "";

  const sep = planUpdate && rlUpdate ? ";" : "";
  const hasPreceding = planUpdate || rlUpdate;
  const query = `${planUpdate}${sep}${rlUpdate}${
    hasPreceding ? ";" : ""
  }SELECT * FROM $id FETCH resourceLimitId;`;

  const result = await db.query<[Plan[]]>(query, bindings);
  const lastIdx = result.length - 1;
  return result[lastIdx]?.[0] ?? null;
}
