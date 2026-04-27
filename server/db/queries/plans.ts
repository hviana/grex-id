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

  const result = await db.query<[unknown, unknown, Plan[]]>(
    `LET $rl = CREATE resource_limit SET
      benefits = $benefits,
      roles = $roles,
      entityLimits = $entityLimits,
      apiRateLimit = $apiRateLimit,
      storageLimitBytes = $storageLimitBytes,
      fileCacheLimitBytes = $fileCacheLimitBytes,
      credits = $credits,
      maxConcurrentDownloads = $maxConcurrentDownloads,
      maxConcurrentUploads = $maxConcurrentUploads,
      maxDownloadBandwidthMB = $maxDownloadBandwidthMB,
      maxUploadBandwidthMB = $maxUploadBandwidthMB,
      maxOperationCountByResourceKey = $maxOperationCountByResourceKey,
      creditLimitByResourceKey = $creditLimitByResourceKey,
      frontendDomains = $frontendDomains;
    LET $p = CREATE plan SET
      name = $name,
      description = $description,
      price = $price,
      currency = $currency,
      recurrenceDays = $recurrenceDays,
      isActive = $isActive,
      resourceLimitId = $rl.id,
      tenantIds = [$tenantId];
    SELECT * FROM $p[0].id FETCH resourceLimitId;`,
    {
      name: data.name,
      description: data.description ?? "",
      tenantId: rid(data.tenantId),
      price: data.price,
      currency: data.currency,
      recurrenceDays: data.recurrenceDays,
      isActive: data.isActive,
      benefits: (rl.benefits as string[]) ?? [],
      roles: (rl.roles as string[]) ?? [],
      entityLimits: rl.entityLimits ?? undefined,
      apiRateLimit: Number(rl.apiRateLimit ?? 0),
      storageLimitBytes: Number(rl.storageLimitBytes ?? 0),
      fileCacheLimitBytes: Number(rl.fileCacheLimitBytes ?? 0),
      credits: Number(rl.credits ?? 0),
      maxConcurrentDownloads: Number(rl.maxConcurrentDownloads ?? 0),
      maxConcurrentUploads: Number(rl.maxConcurrentUploads ?? 0),
      maxDownloadBandwidthMB: Number(rl.maxDownloadBandwidthMB ?? 0),
      maxUploadBandwidthMB: Number(rl.maxUploadBandwidthMB ?? 0),
      maxOperationCountByResourceKey: rl.maxOperationCountByResourceKey ??
        undefined,
      creditLimitByResourceKey: rl.creditLimitByResourceKey ?? undefined,
      frontendDomains: (rl.frontendDomains as string[]) ?? [],
    },
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
    ? `UPDATE $id.resourceLimitId SET ${rlSets.join(", ")}`
    : "";

  const sep = planUpdate && rlUpdate ? ";" : "";
  const query =
    `${planUpdate}${sep}${rlUpdate}SELECT * FROM $id FETCH resourceLimitId;`;

  const result = await db.query<[Plan[]]>(query, bindings);
  const lastIdx = result.length - 1;
  return result[lastIdx]?.[0] ?? null;
}
