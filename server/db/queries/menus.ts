import { getDb, rid } from "../connection.ts";
import type { MenuItem } from "@/src/contracts/menu";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("menus");

export async function listMenuItems(systemId?: string): Promise<MenuItem[]> {
  const db = await getDb();

  let query = "SELECT * FROM menu_item";
  const bindings: Record<string, unknown> = {};

  if (systemId) {
    query += " WHERE systemId = $systemId";
    bindings.systemId = rid(systemId);
  }

  query += " ORDER BY sortOrder ASC";

  const result = await db.query<[MenuItem[]]>(query, bindings);
  return result[0] ?? [];
}
