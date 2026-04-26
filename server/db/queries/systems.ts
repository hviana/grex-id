import { getDb, rid } from "../connection.ts";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("systems");

/**
 * System lookup queries. The `system` table itself is not tenant-scoped —
 * it is referenced by tenant rows. No tenant model changes needed here
 * beyond ensuring consistent `rid` usage.
 */

/** Returns the slug for a system by its record id, or null if not found. */
export async function getSystemSlug(systemId: string): Promise<string | null> {
  const db = await getDb();
  const result = await db.query<[{ slug: string }[]]>(
    "SELECT slug FROM $systemId LIMIT 1",
    { systemId: rid(systemId) },
  );
  return result[0]?.[0]?.slug ?? null;
}

/** Returns the system id by its slug, or null if not found. */
export async function getSystemIdBySlug(slug: string): Promise<string | null> {
  const db = await getDb();
  const result = await db.query<[{ id: string }[]]>(
    "SELECT id FROM system WHERE slug = $slug LIMIT 1",
    { slug },
  );
  return result[0]?.[0]?.id ?? null;
}

/** Checks whether a company record exists for the given record id. */
export async function companyExists(companyId: string): Promise<boolean> {
  const db = await getDb();
  const result = await db.query<[{ id: string }[]]>(
    "SELECT id FROM $companyId LIMIT 1",
    { companyId: rid(companyId) },
  );
  return !!result[0]?.[0];
}
