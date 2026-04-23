import { getDb, rid } from "../connection.ts";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("entity-limits");

/**
 * Count entities of a given table scoped to a company.
 * Used by `withEntityLimit` middleware to enforce plan entity caps.
 */
export async function countEntitiesByCompany(
  tableName: string,
  companyId: string,
): Promise<number> {
  const db = await getDb();
  const countResult = await db.query<[{ count: number }[]]>(
    `SELECT count() AS count FROM type::table($tableName) WHERE companyId = $companyId GROUP ALL;`,
    {
      companyId: rid(companyId),
      tableName,
    },
  );
  return countResult[0]?.[0]?.count ?? 0;
}
