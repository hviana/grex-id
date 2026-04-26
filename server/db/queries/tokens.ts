import { getDb, rid } from "../connection.ts";
import type { ApiToken } from "@/src/contracts/token";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("tokens");

/**
 * Lists live api_tokens (revokedAt IS NONE) scoped to a tenant.
 */
export async function listTokens(
  tenantId: string,
): Promise<ApiToken[]> {
  const db = await getDb();
  const result = await db.query<[ApiToken[]]>(
    `SELECT id, tenantId, name, description,
            roles, monthlySpendLimit, maxOperationCount,
            neverExpires, expiresAt,
            frontendUse, frontendDomains, revokedAt, createdAt
     FROM api_token WHERE tenantId = $tenantId AND revokedAt IS NONE
     ORDER BY createdAt DESC`,
    { tenantId: rid(tenantId) },
  );
  return result[0] ?? [];
}

/**
 * Lists live api_tokens (revokedAt IS NONE), optionally filtered by
 * `tenantId`. Returns up to 50 results ordered by createdAt DESC.
 */
export async function listTokensFiltered(params: {
  tenantId?: string;
}): Promise<ApiToken[]> {
  const db = await getDb();
  const bindings: Record<string, unknown> = {};
  const conditions: string[] = ["revokedAt IS NONE"];

  if (params.tenantId) {
    conditions.push("tenantId = $tenantId");
    bindings.tenantId = rid(params.tenantId);
  }

  const query =
    `SELECT id, name, description, roles, monthlySpendLimit, maxOperationCount,
            neverExpires, expiresAt, frontendUse, frontendDomains, createdAt
     FROM api_token WHERE ${conditions.join(" AND ")}
     ORDER BY createdAt DESC LIMIT 50`;

  const result = await db.query<[ApiToken[]]>(query, bindings);
  return result[0] ?? [];
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
    [{ tenantId: string }[], unknown]
  >(
    `SELECT tenantId FROM $id LIMIT 1;
     UPDATE $id SET revokedAt = time::now() WHERE revokedAt IS NONE;`,
    { id: rid(id) },
  );
  const row = result[0]?.[0];
  if (row?.tenantId) {
    return {
      tenantId: String(row.tenantId),
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
