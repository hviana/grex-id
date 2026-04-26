import { getDb, rid } from "../connection.ts";
import type { MenuItem } from "@/src/contracts/menu";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("menus");

/**
 * menu_item has `tenantIds: array<record<tenant>>` referencing a system-level tenant
 * row instead of `systemId`. Filtering by tenantIds scopes menus to a system.
 */
export async function listMenuItems(tenantId?: string): Promise<MenuItem[]> {
  const db = await getDb();

  let query = "SELECT * FROM menu_item";
  const bindings: Record<string, unknown> = {};

  if (tenantId) {
    query += " WHERE tenantIds CONTAINS $tenantId";
    bindings.tenantId = rid(tenantId);
  }

  query += " ORDER BY sortOrder ASC";

  const result = await db.query<[MenuItem[]]>(query, bindings);
  return result[0] ?? [];
}
