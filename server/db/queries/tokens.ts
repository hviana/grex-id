import { getDb, rid } from "../connection.ts";
import type { ApiToken } from "@/src/contracts/api-token";
import type { TokenCleanupResult } from "@/src/contracts/high-level/query-results";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("tokens");

/**
 * Creates a resource_limit AND an api_token in one batched query (§2.4).
 * Returns the created token so the route handler can issue a JWT whose
 * actorId is the api_token id.
 */
export async function createTokenWithResourceLimit(data: {
  name: string;
  description?: string;
  actorType: "app" | "token";
  tenantId: string;
  resourceLimits?: Record<string, unknown>;
  neverExpires: boolean;
  expiresAt?: Date;
}): Promise<ApiToken | null> {
  const db = await getDb();
  const rl = data.resourceLimits ?? {};

  const rlFields: string[] = [];
  const bindings: Record<string, unknown> = {
    name: data.name,
    description: data.description ?? "",
    actorType: data.actorType,
    tenantId: rid(data.tenantId),
    neverExpires: data.neverExpires,
  };
  if (data.expiresAt) {
    bindings.expiresAt = data.expiresAt;
  }

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

  const apiTokenSets = [
    "tenantIds = {$tenantId,}",
    "name = $name",
    "description = $description",
    "actorType = $actorType",
    "resourceLimitId = $rl[0].id",
    "neverExpires = $neverExpires",
  ];
  if (data.expiresAt) {
    apiTokenSets.push("expiresAt = $expiresAt");
  }

  const result = await db.query<[unknown, unknown, ApiToken[]]>(
    `LET $rl = CREATE resource_limit SET
      ${rlFields.join(",\n      ")};
    LET $tkn = CREATE api_token SET
      ${apiTokenSets.join(",\n      ")};
    SELECT * FROM $tkn[0].id FETCH resourceLimitId;`,
    bindings,
  );

  return result[2]?.[0] ?? null;
}

/**
 * Revokes an api_token by setting revokedAt = time::now() in a single
 * batched query. Returns the tenantId needed to update the actor-validity
 * cache.
 */
export async function revokeToken(id: string): Promise<
  { tenantId: string } | null
> {
  const db = await getDb();
  const result = await db.query<
    [{ tenantIds: string[] }[], unknown]
  >(
    `SELECT tenantIds FROM $id LIMIT 1;
     UPDATE $id SET revokedAt = time::now() WHERE revokedAt IS NONE;`,
    { id: rid(id) },
  );
  const row = result[0]?.[0];
  const rawTenantIds = row?.tenantIds;
  const tenantId: string | undefined = rawTenantIds instanceof Set
    ? ([...rawTenantIds][0] as string | undefined)
    : Array.isArray(rawTenantIds)
    ? rawTenantIds[0]
    : undefined;
  if (tenantId) {
    return {
      tenantId: String(tenantId),
    };
  }
  return null;
}

// ─── Token cleanup (used by token-cleanup job) ────────────────────────────

// TokenCleanupResult is now in @/src/contracts/high-level/query-results

export async function cleanupRevokedTokens(): Promise<TokenCleanupResult> {
  const db = await getDb();
  const result = await db.query<
    [unknown, { count: number }[]]
  >(
    `LET $cutoff = time::now() - 90d;
     DELETE FROM api_token WHERE revokedAt IS NOT NONE AND revokedAt < $cutoff RETURN count() AS count;`,
  );

  const tokensDeleted = result[1]?.[0]?.count ?? 0;

  return { tokensDeleted };
}
