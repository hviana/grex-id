import { getDb, rid } from "../connection.ts";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("tokens");

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

export interface TokenCleanupResult {
  tokensDeleted: number;
  appsDeleted: number;
}

export async function cleanupRevokedTokens(): Promise<TokenCleanupResult> {
  const db = await getDb();
  const result = await db.query<
    [unknown, { count: number }[], { count: number }[]]
  >(
    `LET $cutoff = time::now() - 90d;
     DELETE FROM api_token WHERE revokedAt IS NOT NONE AND revokedAt < $cutoff RETURN count() AS count;
     DELETE FROM connected_app WHERE apiTokenId NOT IN (SELECT VALUE id FROM api_token) RETURN count() AS count;`,
  );

  const tokensDeleted = result[1]?.[0]?.count ?? 0;
  const appsDeleted = result[2]?.[0]?.count ?? 0;

  return { tokensDeleted, appsDeleted };
}
