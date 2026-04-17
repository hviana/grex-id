import { getDb, rid } from "../connection.ts";
import type { System } from "@/src/contracts/system";
import type { CursorParams, PaginatedResult } from "@/src/contracts/common";
import { paginatedQuery } from "./pagination.ts";

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
