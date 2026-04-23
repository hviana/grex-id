import { getDb, rid } from "../connection.ts";
import type { Tag } from "@/src/contracts/tag";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("tags");

export async function searchTags(
  companyId: string,
  systemId: string,
  search: string,
): Promise<Tag[]> {
  const db = await getDb();
  const result = await db.query<[Tag[]]>(
    `SELECT * FROM tag
     WHERE companyId = $companyId
       AND systemId = $systemId
       AND name @@ $search
     LIMIT 20`,
    { companyId: rid(companyId), systemId: rid(systemId), search },
  );
  return result[0] ?? [];
}

export async function listTags(
  companyId: string,
  systemId: string,
): Promise<Tag[]> {
  const db = await getDb();
  const result = await db.query<[Tag[]]>(
    `SELECT * FROM tag
     WHERE companyId = $companyId
       AND systemId = $systemId
     ORDER BY name ASC`,
    { companyId: rid(companyId), systemId: rid(systemId) },
  );
  return result[0] ?? [];
}

export async function getTagById(id: string): Promise<Tag | null> {
  const db = await getDb();
  const result = await db.query<[Tag[]]>(
    "SELECT * FROM tag WHERE id = $id LIMIT 1",
    { id: rid(id) },
  );
  return result[0]?.[0] ?? null;
}

export async function createTag(data: {
  name: string;
  color: string;
  companyId: string;
  systemId: string;
}): Promise<Tag> {
  const db = await getDb();
  const result = await db.query<[Tag[]]>(
    `CREATE tag SET
      name = $name,
      color = $color,
      companyId = $companyId,
      systemId = $systemId`,
    { ...data, companyId: rid(data.companyId), systemId: rid(data.systemId) },
  );
  return result[0][0];
}

export async function updateTag(
  id: string,
  data: { name?: string; color?: string },
): Promise<Tag> {
  const db = await getDb();
  const sets: string[] = [];
  const bindings: Record<string, unknown> = { id: rid(id) };

  if (data.name !== undefined) {
    sets.push("name = $name");
    bindings.name = data.name;
  }
  if (data.color !== undefined) {
    sets.push("color = $color");
    bindings.color = data.color;
  }

  const result = await db.query<[Tag[]]>(
    `UPDATE $id SET ${sets.join(", ")}`,
    bindings,
  );
  return result[0][0];
}

export async function deleteTag(id: string): Promise<void> {
  const db = await getDb();
  await db.query("DELETE FROM tag WHERE id = $id", { id: rid(id) });
}
