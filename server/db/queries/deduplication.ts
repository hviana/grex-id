import { getDb, rid } from "../connection.ts";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("deduplication");

/**
 * Checks for existing records matching the given field/value pairs.
 * Each check is batched into a single query with dynamic bindings.
 * Optionally scoped by tenantId when the entity is tenant-scoped.
 *
 * Returns an array of result sets, one per field, in order.
 */
export async function queryDuplicateChecks(
  entity: string,
  fields: { field: string; value: unknown }[],
  excludeId?: string,
  tenantId?: string,
): Promise<{ id: string }[][]> {
  const db = await getDb();

  const excludeClause = excludeId ? " AND id != $excludeId" : "";
  const tenantClause = tenantId ? " AND tenantId = $tenantId" : "";
  const statements = fields
    .map((f, i) =>
      `SELECT id FROM type::table($entity) WHERE ${f.field} = $val_${i}${excludeClause}${tenantClause} LIMIT 1`
    )
    .join(";\n");
  const bindings: Record<string, unknown> = { entity };
  if (excludeId) bindings.excludeId = rid(excludeId);
  if (tenantId) bindings.tenantId = rid(tenantId);
  fields.forEach((f, i) => {
    bindings[`val_${i}`] = f.value;
  });

  return db.query<{ id: string }[][]>(statements, bindings);
}
