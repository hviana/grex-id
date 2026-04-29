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

  const result = await db.query<[unknown, unknown, ApiToken[]]>(
    `LET $rl = CREATE resource_limit SET
      benefits = $benefits,
      roleIds = $roleIds,
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
    LET $tkn = CREATE api_token SET
      tenantIds = {$tenantId},
      name = $name,
      description = $description,
      actorType = $actorType,
      resourceLimitId = $rl.id,
      neverExpires = $neverExpires,
      expiresAt = $expiresAt;
    SELECT * FROM $tkn[0].id FETCH resourceLimitId;`,
    {
      name: data.name,
      description: data.description ?? "",
      actorType: data.actorType,
      tenantId: rid(data.tenantId),
      benefits: (rl.benefits as string[]) ?? [],
      roleIds: (rl.roleIds as string[]) ?? [],
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
      neverExpires: data.neverExpires,
      expiresAt: data.expiresAt ?? undefined,
    },
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
  const tenantId = Array.isArray(row?.tenantIds)
    ? row!.tenantIds[0]
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
