import { getDb, rid } from "../connection.ts";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("actor-validity");

/**
 * Loads all non-revoked api_token ids for a tenant partition.
 * Used by the actor-validity cache to hydrate a tenant's in-memory set.
 */
export async function fetchActiveApiTokenIds(params: {
  companyId: string;
  systemId: string;
}): Promise<{ id: string }[]> {
  const db = await getDb();
  const result = await db.query<[{ id: string }[]]>(
    `SELECT id FROM api_token
       WHERE companyId = $companyId AND systemId = $systemId
         AND revokedAt IS NONE`,
    { companyId: rid(params.companyId), systemId: rid(params.systemId) },
  );
  return result[0] ?? [];
}
