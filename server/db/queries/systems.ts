import { getDb } from "../connection.ts";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("systems");

/**
 * System lookup queries. The `system` table itself is not tenant-scoped —
 * it is referenced by tenant rows. No tenant model changes needed here.
 */

/** Returns the system id by its slug, or null if not found. */
export async function getSystemIdBySlug(slug: string): Promise<string | null> {
  const db = await getDb();
  const result = await db.query<[{ id: string }[]]>(
    "SELECT id FROM system WHERE slug = $slug LIMIT 1",
    { slug },
  );
  return result[0]?.[0]?.id ?? null;
}
