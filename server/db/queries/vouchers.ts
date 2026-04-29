import { getDb, rid } from "../connection.ts";
import type { Voucher } from "@/src/contracts/voucher";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("vouchers");

/**
 * Creates a resource_limit AND a voucher in one batched query (§2.4).
 * Returns the created voucher with resourceLimitId fetched.
 */
export async function createVoucherWithResourceLimit(data: {
  name: string;
  applicableTenantIds: string[];
  applicablePlanIds: string[];
  expiresAt?: Date;
  resourceLimits?: Record<string, unknown>;
}): Promise<Voucher | null> {
  const db = await getDb();
  const rl = data.resourceLimits ?? {};

  const rlFields: string[] = [];
  const bindings: Record<string, unknown> = {
    name: data.name,
    expiresAt: data.expiresAt ?? undefined,
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

  // Build SurrealQL set literals with type::record() for proper coercion.
  const buildSetLiteral = (ids: string[]): string => {
    if (ids.length === 0) return "<set>[]";
    const parts = ids.map((id) => {
      const [tb, rid_] = id.split(":");
      return `type::record("${tb}", "${rid_}")`;
    });
    return `{${parts.join(", ")},}`;
  };
  const tenantIdsLiteral = buildSetLiteral(data.applicableTenantIds);
  const planIdsLiteral = buildSetLiteral(data.applicablePlanIds);

  const voucherSets = [
    "name = $name",
    "resourceLimitId = $rl[0].id",
    `applicableTenantIds = ${tenantIdsLiteral}`,
    `applicablePlanIds = ${planIdsLiteral}`,
  ];
  if (data.expiresAt) {
    voucherSets.push("expiresAt = $expiresAt");
  }

  const result = await db.query<[unknown, unknown, Voucher[]]>(
    `LET $rl = CREATE resource_limit SET
      ${rlFields.join(",\n      ")};
    LET $v = CREATE voucher SET
      ${voucherSets.join(",\n      ")};
    SELECT * FROM $v[0].id FETCH resourceLimitId;`,
    bindings,
  );

  return result[2]?.[0] ?? null;
}

/**
 * Updates a voucher and its linked resource_limit in one batched query
 * with auto-removal cascade (§7.7).
 */
export async function updateVoucherWithCascade(
  id: string,
  voucherSets: string[],
  rlSets: string[],
  bindings: Record<string, unknown>,
  shouldCascadePlans: boolean,
  shouldCascadeTenants: boolean,
): Promise<Voucher | null> {
  if (voucherSets.length === 0 && rlSets.length === 0) return null;

  const db = await getDb();
  bindings.id = rid(String(id));

  const cascadeParts: string[] = [];
  if (shouldCascadePlans) {
    cascadeParts.push(
      `UPDATE subscription SET voucherId = NONE
       WHERE voucherId = $id
         AND planId NOT IN $applicablePlanIds;`,
    );
  }
  if (shouldCascadeTenants) {
    cascadeParts.push(
      `UPDATE subscription SET voucherId = NONE
       WHERE voucherId = $id
         AND tenantIds NONEINSIDE $applicableTenantIds;`,
    );
  }

  const voucherUpdate = voucherSets.length > 0
    ? `UPDATE $id SET ${voucherSets.join(", ")}`
    : "";
  const rlUpdate = rlSets.length > 0
    ? `LET $rl = $id.resourceLimitId; UPDATE $rl SET ${rlSets.join(", ")}`
    : "";

  const hasPreceding = voucherUpdate || rlUpdate || cascadeParts.length > 0;
  const result = await db.query<[Voucher[]]>(
    `${voucherUpdate}${voucherUpdate && rlUpdate ? ";" : ""}${rlUpdate}${
      cascadeParts.join("")
    }${hasPreceding ? ";" : ""}SELECT * FROM $id FETCH resourceLimitId;`,
    bindings,
  );

  // Last query result is the SELECT
  const lastIdx = result.length - 1;
  return result[lastIdx]?.[0] ?? null;
}

/**
 * Removes voucher reference from subscriptions and deletes the voucher
 * in one batched query.
 */
export async function deleteVoucher(id: string): Promise<void> {
  const db = await getDb();
  await db.query(
    `UPDATE subscription SET voucherId = NONE WHERE voucherId = $id;
     DELETE $id;`,
    { id: rid(id) },
  );
}
