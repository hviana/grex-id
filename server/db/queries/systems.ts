import { getDb, rid } from "../connection.ts";
import type { System } from "@/src/contracts/system";
import type { CursorParams, PaginatedResult } from "@/src/contracts/common";
import { paginatedQuery } from "./pagination.ts";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("systems");

export async function listSystems(
  params: CursorParams & { search?: string },
): Promise<PaginatedResult<System>> {
  const conditions: string[] = [];
  const bindings: Record<string, unknown> = {};

  if (params.search) {
    conditions.push("name @@ $search");
    bindings.search = params.search;
  }

  return paginatedQuery<System>({
    table: "system",
    conditions,
    bindings,
    params,
  });
}

export async function getSystem(id: string): Promise<System | null> {
  const db = await getDb();
  const result = await db.query<[System[]]>("SELECT * FROM $id", {
    id: rid(id),
  });
  return result[0]?.[0] ?? null;
}

export async function createSystem(data: {
  name: string;
  slug: string;
  logoUri: string;
  termsOfService?: string;
}): Promise<System> {
  const db = await getDb();
  const result = await db.query<[System[]]>(
    `CREATE system SET name = $name, slug = $slug, logoUri = $logoUri, termsOfService = $termsOfService`,
    { ...data, termsOfService: data.termsOfService ?? undefined },
  );
  return result[0][0];
}

export async function updateSystem(
  id: string,
  data: Partial<{
    name: string;
    slug: string;
    logoUri: string;
    termsOfService: string;
  }>,
): Promise<System> {
  const db = await getDb();
  const sets: string[] = [];
  const bindings: Record<string, unknown> = { id: rid(id) };

  if (data.name !== undefined) {
    sets.push("name = $name");
    bindings.name = data.name;
  }
  if (data.slug !== undefined) {
    sets.push("slug = $slug");
    bindings.slug = data.slug;
  }
  if (data.logoUri !== undefined) {
    sets.push("logoUri = $logoUri");
    bindings.logoUri = data.logoUri;
  }
  if (data.termsOfService !== undefined) {
    sets.push("termsOfService = $termsOfService");
    bindings.termsOfService = data.termsOfService || undefined;
  }
  sets.push("updatedAt = time::now()");

  const result = await db.query<[System[]]>(
    `UPDATE $id SET ${sets.join(", ")} RETURN AFTER`,
    bindings,
  );
  return result[0][0];
}

export async function deleteSystem(id: string): Promise<void> {
  const db = await getDb();
  await db.query("DELETE $id", { id: rid(id) });
}

/** Returns the slug for a system by its record id, or null if not found. */
export async function getSystemSlug(systemId: string): Promise<string | null> {
  const db = await getDb();
  const result = await db.query<[{ slug: string }[]]>(
    "SELECT slug FROM $systemId LIMIT 1",
    { systemId },
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
    { companyId },
  );
  return !!result[0]?.[0];
}
