import { getDb, rid } from "../connection.ts";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("entity-limits");

export async function countEntitiesByTenant(
  tableName: string,
  tenantId: string,
): Promise<number> {
  const db = await getDb();
  const countResult = await db.query<[{ count: number }[]]>(
    `SELECT count() AS count FROM type::table($tableName) WHERE tenantIds CONTAINS $tenantId GROUP ALL;`,
    {
      tenantId: rid(tenantId),
      tableName,
    },
  );
  return countResult[0]?.[0]?.count ?? 0;
}
