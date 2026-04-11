import { getDb, rid } from "../connection.ts";
import type { System } from "@/src/contracts/system";
import type { CursorParams, PaginatedResult } from "@/src/contracts/common";
import { clampPageLimit } from "@/src/lib/validators";

export async function listSystems(
  params: CursorParams & { search?: string },
): Promise<PaginatedResult<System>> {
  const db = await getDb();
  const limit = clampPageLimit(params.limit);

  let query = "SELECT * FROM system";
  const bindings: Record<string, unknown> = { limit: limit + 1 };

  if (params.search) {
    query += " WHERE name @@ $search";
    bindings.search = params.search;
  }

  if (params.cursor) {
    query += params.search ? " AND" : " WHERE";
    query += params.direction === "prev" ? " id < $cursor" : " id > $cursor";
    bindings.cursor = params.cursor;
  }

  query += " ORDER BY createdAt DESC LIMIT $limit";

  const result = await db.query<[System[]]>(query, bindings);
  const items = result[0] ?? [];
  const hasMore = items.length > limit;
  const data = hasMore ? items.slice(0, limit) : items;

  return {
    data,
    nextCursor: hasMore ? data[data.length - 1]?.id ?? null : null,
    prevCursor: params.cursor ?? null,
  };
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
