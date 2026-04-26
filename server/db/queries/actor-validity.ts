import { getDb, rid } from "../connection.ts";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("actor-validity");

/**
 * Loads all non-revoked api_token ids for a tenant partition.
 * Used by the actor-validity cache to hydrate a tenant's in-memory set.
 * Now scopes by tenantIds (the tenant record IDs) instead of companyId/systemId.
 */
export async function fetchActiveApiTokenIds(params: {
  tenantId: string;
}): Promise<{ id: string }[]> {
  const db = await getDb();
  const result = await db.query<[{ id: string }[]]>(
    `SELECT id, tenantIds FROM api_token
       WHERE tenantIds CONTAINS $tenantId
         AND revokedAt IS NONE`,
    { tenantId: rid(params.tenantId) },
  );
  return result[0] ?? [];
}
