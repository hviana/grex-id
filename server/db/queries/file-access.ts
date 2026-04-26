import { getDb, rid } from "../connection.ts";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("file-access");

/**
 * File access rule queries. file_access uses `roles: array<string>` instead
 * of `permissions`. The rules are not tenant-scoped — they are global
 * configuration loaded into cache.
 */

export async function updateFileAccessRule(
  id: string,
  sets: string[],
  bindings: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const db = await getDb();
  bindings.id = rid(id);

  const result = await db.query<[Record<string, unknown>[]]>(
    `UPDATE $id SET ${sets.join(", ")} RETURN AFTER`,
    bindings,
  );
  return result[0]?.[0] ?? null;
}

/**
 * Loads all file access rules from the database for cache hydration.
 * Returns raw records ordered by creation date.
 */
export async function fetchAllFileAccessRules(): Promise<
  Record<string, unknown>[]
> {
  const db = await getDb();
  const result = await db.query<[Record<string, unknown>[]]>(
    "SELECT * FROM file_access ORDER BY createdAt ASC",
  );
  return result[0] ?? [];
}
