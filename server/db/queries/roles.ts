import { getDb, rid } from "../connection.ts";
import type { Role } from "@/src/contracts/role";
import type { CursorParams, PaginatedResult } from "@/src/contracts/common";
import { clampPageLimit } from "@/src/lib/validators";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("roles");

export async function listRoles(
  params: CursorParams & { search?: string; systemId?: string },
): Promise<PaginatedResult<Role>> {
  const db = await getDb();
  const limit = clampPageLimit(params.limit);
  const bindings: Record<string, unknown> = { limit: limit + 1 };
  const conditions: string[] = [];

  if (params.systemId) {
    conditions.push("systemId = $systemId");
    bindings.systemId = rid(params.systemId);
  }
  if (params.search) {
    conditions.push("name CONTAINS $search");
    bindings.search = params.search;
  }
  if (params.cursor) {
    conditions.push(
      params.direction === "prev" ? "id < $cursor" : "id > $cursor",
    );
    bindings.cursor = params.cursor;
  }

  let query = "SELECT * FROM role";
  if (conditions.length) query += " WHERE " + conditions.join(" AND ");
  query += " ORDER BY createdAt DESC LIMIT $limit";

  const result = await db.query<[Role[]]>(query, bindings);
  const items = result[0] ?? [];
  const hasMore = items.length > limit;
  const data = hasMore ? items.slice(0, limit) : items;

  return {
    data,
    nextCursor: hasMore ? data[data.length - 1]?.id ?? null : null,
    prevCursor: params.cursor ?? null,
  };
}
