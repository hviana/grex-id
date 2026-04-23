import { getDb, rid } from "../connection.ts";
import type { ApiToken } from "@/src/contracts/token";
import type { Tenant } from "@/src/contracts/tenant";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("tokens");

/**
 * Lists live api_tokens (revokedAt IS NONE) owned by `userId`, optionally
 * scoped to `companyId`. Used by the Tokens page (§21.2).
 */
export async function listTokens(
  userId: string,
  companyId?: string,
): Promise<ApiToken[]> {
  const db = await getDb();
  const bindings: Record<string, unknown> = { userId: rid(userId) };
  let query =
    `SELECT id, userId, tenant, companyId, systemId, name, description,
            permissions, monthlySpendLimit, maxOperationCount,
            neverExpires, expiresAt,
            frontendUse, frontendDomains, revokedAt, createdAt
     FROM api_token WHERE userId = $userId AND revokedAt IS NONE`;

  if (companyId) {
    query += " AND companyId = $companyId";
    bindings.companyId = rid(companyId);
  }

  query += " ORDER BY createdAt DESC";

  const result = await db.query<[ApiToken[]]>(query, bindings);
  return result[0] ?? [];
}

/**
 * Lists live api_tokens (revokedAt IS NONE), optionally filtered by
 * `userId` and/or `companyId`. Returns up to 50 results ordered by
 * createdAt DESC. Used by the GET /api/tokens route.
 */
export async function listTokensFiltered(params: {
  userId?: string;
  companyId?: string;
}): Promise<ApiToken[]> {
  const db = await getDb();
  const bindings: Record<string, unknown> = {};
  const conditions: string[] = [];

  if (params.userId) {
    conditions.push("userId = $userId");
    bindings.userId = rid(params.userId);
  }
  if (params.companyId && params.companyId !== "0") {
    conditions.push("companyId = $companyId");
    bindings.companyId = rid(params.companyId);
  }

  let query =
    `SELECT id, name, description, permissions, monthlySpendLimit, maxOperationCount,
            neverExpires, expiresAt, frontendUse, frontendDomains, createdAt
     FROM api_token WHERE revokedAt IS NONE`;

  if (conditions.length) query += " AND " + conditions.join(" AND ");
  query += " ORDER BY createdAt DESC LIMIT 50";

  const result = await db.query<[ApiToken[]]>(query, bindings);
  return result[0] ?? [];
}

/**
 * Creates a new api_token row with all fields. Returns the created record.
 * Single batched query (§7.2).
 */
export async function createApiToken(params: {
  userId: string;
  companyId: string;
  systemId: string;
  tenant: Tenant;
  name: string;
  description?: string;
  permissions: string[];
  monthlySpendLimit?: number;
  maxOperationCount?: Record<string, number>;
  neverExpires: boolean;
  expiresAt?: Date;
  frontendUse: boolean;
  frontendDomains: string[];
}): Promise<ApiToken | undefined> {
  const db = await getDb();
  const result = await db.query<[ApiToken[]]>(
    `CREATE api_token SET
      userId = $userId,
      companyId = $companyId,
      systemId = $systemId,
      tenant = $tenant,
      name = $name,
      description = $description,
      permissions = $permissions,
      monthlySpendLimit = $monthlySpendLimit,
      maxOperationCount = $maxOperationCount,
      neverExpires = $neverExpires,
      expiresAt = $expiresAt,
      frontendUse = $frontendUse,
      frontendDomains = $frontendDomains`,
    {
      userId: rid(params.userId),
      companyId: rid(params.companyId),
      systemId: rid(params.systemId),
      tenant: params.tenant,
      name: params.name,
      description: params.description ?? undefined,
      permissions: params.permissions,
      monthlySpendLimit: params.monthlySpendLimit ?? undefined,
      maxOperationCount: params.maxOperationCount ?? undefined,
      neverExpires: params.neverExpires,
      expiresAt: params.expiresAt ?? undefined,
      frontendUse: params.frontendUse,
      frontendDomains: params.frontendDomains,
    },
  );
  return result[0]?.[0];
}

/**
 * Revokes an api_token by setting revokedAt = time::now() in a single
 * batched query that first selects the token's companyId and systemId.
 * Returns the tenant info needed to update the actor-validity cache.
 */
export async function revokeToken(id: string): Promise<
  {
    companyId: string;
    systemId: string;
  } | null
> {
  const db = await getDb();
  const result = await db.query<
    [{ companyId: string; systemId: string }[], unknown]
  >(
    `SELECT companyId, systemId FROM $id LIMIT 1;
     UPDATE $id SET revokedAt = time::now() WHERE revokedAt IS NONE;`,
    { id: rid(id) },
  );
  const row = result[0]?.[0];
  if (row?.companyId && row?.systemId) {
    return {
      companyId: String(row.companyId),
      systemId: String(row.systemId),
    };
  }
  return null;
}

/** Hard-delete — used by the token-cleanup job (§16). */
export async function deleteToken(id: string): Promise<void> {
  const db = await getDb();
  await db.query("DELETE $id", { id: rid(id) });
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
