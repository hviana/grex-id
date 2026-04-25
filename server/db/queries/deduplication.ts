import { getDb } from "../connection.ts";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("deduplication");

/**
 * Checks for existing records matching the given field/value pairs.
 * Each check is batched into a single query with dynamic bindings.
 *
 * Returns an array of result sets, one per field, in order.
 */
export async function queryDuplicateChecks(
  entity: string,
  fields: { field: string; value: unknown }[],
  excludeId?: string,
): Promise<{ id: string }[][]> {
  const db = await getDb();

  const excludeClause = excludeId ? " AND id != $excludeId" : "";
  const statements = fields
    .map((f, i) =>
      `SELECT id FROM type::table($entity) WHERE ${f.field} = $val_${i}${excludeClause} LIMIT 1`
    )
    .join(";\n");
  const bindings: Record<string, unknown> = { entity };
  if (excludeId) bindings.excludeId = excludeId;
  fields.forEach((f, i) => {
    bindings[`val_${i}`] = f.value;
  });

  return db.query<{ id: string }[][]>(statements, bindings);
}
