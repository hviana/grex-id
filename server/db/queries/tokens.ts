import "server-only";

import { getDb, rid, setsToArrays } from "../connection.ts";
import type { TokenCleanupResult } from "@/src/contracts/high-level/query-results";

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

export async function revokeToken(id: string): Promise<void> {
  const db = await getDb();
  await db.query("UPDATE $id SET revokedAt = time::now()", { id: rid(id) });
}

/**
 * Lists api_tokens scoped to a company-system tenant with resourceLimitId
 * fetched and role names resolved.
 */
export async function getTokensForTenant(params: {
  companyId: string;
  systemId: string;
  actorType?: string;
  limit: number;
}): Promise<{
  items: Record<string, unknown>[];
}> {
  const db = await getDb();
  const bindings: Record<string, unknown> = {
    companyId: rid(params.companyId),
    systemId: rid(params.systemId),
    limit: params.limit,
  };

  let extraCond = "";
  if (params.actorType) {
    extraCond = " AND actorType = $actorType";
    bindings.actorType = params.actorType;
  }

  const query =
    `SELECT id, name, description, actorType, neverExpires, expiresAt, createdAt, resourceLimitId,
       (SELECT VALUE name FROM role WHERE id IN $parent.resourceLimitId.roleIds) AS _resourceLimitRoleNames
     FROM api_token
     WHERE revokedAt IS NONE${extraCond}
       AND tenantIds CONTAINSANY (SELECT VALUE id FROM tenant
         WHERE companyId = $companyId AND systemId = $systemId)
     ORDER BY createdAt DESC LIMIT $limit FETCH resourceLimitId`;

  const result = await db.query<[Record<string, unknown>[]]>(query, bindings);
  const rawItems = result[0] ?? [];
  const items = rawItems.map((item) => setsToArrays(item));

  return { items };
}
