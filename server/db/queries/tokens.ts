import { getDb, rid } from "../connection.ts";
import type { ApiToken } from "@/src/contracts/token";

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

/** Hard-delete — used by the token-cleanup job (§16). */
export async function deleteToken(id: string): Promise<void> {
  const db = await getDb();
  await db.query("DELETE $id", { id: rid(id) });
}
