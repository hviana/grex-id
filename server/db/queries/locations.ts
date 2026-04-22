import { getDb, rid } from "@/server/db/connection";
import type { CursorParams, PaginatedResult } from "@/src/contracts/common";
import { clampPageLimit } from "@/src/lib/validators";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("locations");

export interface Location {
  id: string;
  name: string;
  description?: string;
  companyId: string;
  systemId: string;
  address: {
    street: string;
    number: string;
    complement?: string;
    neighborhood?: string;
    city: string;
    state: string;
    country: string;
    postalCode: string;
  };
  createdAt: string;
  updatedAt: string;
}

export async function listLocations(
  params: CursorParams & {
    search?: string;
    companyId: string;
    systemId: string;
  },
): Promise<PaginatedResult<Location>> {
  const db = await getDb();
  const limit = clampPageLimit(params.limit);
  const bindings: Record<string, unknown> = {
    limit: limit + 1,
    companyId: rid(params.companyId),
    systemId: rid(params.systemId),
  };

  let query =
    "SELECT * FROM location WHERE companyId = $companyId AND systemId = $systemId";

  if (params.search) {
    query += " AND name @@ $search";
    bindings.search = params.search;
  }
  if (params.cursor) {
    query += params.direction === "prev"
      ? " AND id < $cursor"
      : " AND id > $cursor";
    bindings.cursor = params.cursor;
  }

  query += " ORDER BY createdAt DESC LIMIT $limit";

  const result = await db.query<[Location[]]>(query, bindings);
  const items = result[0] ?? [];
  const hasMore = items.length > limit;
  const data = hasMore ? items.slice(0, limit) : items;

  return {
    data,
    nextCursor: hasMore ? data[data.length - 1]?.id ?? null : null,
    prevCursor: params.cursor ?? null,
  };
}

export async function getLocationById(
  id: string,
): Promise<Location | null> {
  const db = await getDb();
  const result = await db.query<[Location[]]>(
    "SELECT * FROM location WHERE id = $id LIMIT 1",
    { id: rid(id) },
  );
  return result[0]?.[0] ?? null;
}

export async function createLocation(data: {
  name: string;
  description?: string;
  companyId: string;
  systemId: string;
  address: Record<string, string>;
}): Promise<Location> {
  const db = await getDb();
  const result = await db.query<[Location[]]>(
    `CREATE location SET
      name = $name,
      description = $description,
      companyId = $companyId,
      systemId = $systemId,
      address = $address`,
    {
      name: data.name,
      description: data.description || null,
      companyId: rid(data.companyId),
      systemId: rid(data.systemId),
      address: data.address,
    },
  );
  return result[0][0];
}

export async function updateLocation(
  id: string,
  data: {
    name?: string;
    description?: string;
    address?: Record<string, string>;
  },
): Promise<Location> {
  const db = await getDb();
  const sets: string[] = ["updatedAt = time::now()"];
  const bindings: Record<string, unknown> = { id: rid(id) };

  if (data.name !== undefined) {
    sets.push("name = $name");
    bindings.name = data.name;
  }
  if (data.description !== undefined) {
    sets.push("description = $description");
    bindings.description = data.description || null;
  }
  if (data.address !== undefined) {
    sets.push("address = $address");
    bindings.address = data.address;
  }

  const result = await db.query<[Location[]]>(
    `UPDATE $id SET ${sets.join(", ")}`,
    bindings,
  );
  return result[0][0];
}

export async function deleteLocation(id: string): Promise<void> {
  const db = await getDb();
  await db.query("DELETE FROM location WHERE id = $id", { id: rid(id) });
}
