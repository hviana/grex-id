import { getDb } from "../connection.ts";
import type { CoreSetting } from "@/src/contracts/core-settings";

export async function listSettings(
  systemSlug?: string,
): Promise<CoreSetting[]> {
  const db = await getDb();
  if (systemSlug) {
    const result = await db.query<[CoreSetting[]]>(
      "SELECT * FROM setting WHERE systemSlug = $systemSlug ORDER BY key ASC",
      { systemSlug },
    );
    return result[0] ?? [];
  }
  const result = await db.query<[CoreSetting[]]>(
    "SELECT * FROM setting WHERE systemSlug IS NONE ORDER BY key ASC",
  );
  return result[0] ?? [];
}

export async function getSetting(
  key: string,
  systemSlug?: string,
): Promise<CoreSetting | null> {
  const db = await getDb();
  if (systemSlug) {
    const result = await db.query<[CoreSetting[]]>(
      "SELECT * FROM setting WHERE key = $key AND systemSlug = $systemSlug LIMIT 1",
      { key, systemSlug },
    );
    return result[0]?.[0] ?? null;
  }
  const result = await db.query<[CoreSetting[]]>(
    "SELECT * FROM setting WHERE key = $key AND systemSlug IS NONE LIMIT 1",
    { key },
  );
  return result[0]?.[0] ?? null;
}

export async function upsertSetting(data: {
  key: string;
  value: string;
  description: string;
  systemSlug?: string;
}): Promise<CoreSetting> {
  const db = await getDb();
  if (data.systemSlug) {
    const result = await db.query<[CoreSetting[]]>(
      `UPSERT setting SET
        key = $key,
        value = $value,
        description = $description,
        systemSlug = $systemSlug,
        updatedAt = time::now()
      WHERE key = $key AND systemSlug = $systemSlug`,
      data,
    );
    return result[0][0];
  }
  const result = await db.query<[CoreSetting[]]>(
    `UPSERT setting SET
      key = $key,
      value = $value,
      description = $description,
      systemSlug = NONE,
      updatedAt = time::now()
    WHERE key = $key AND systemSlug IS NONE`,
    { key: data.key, value: data.value, description: data.description },
  );
  return result[0][0];
}

export async function deleteSetting(
  key: string,
  systemSlug?: string,
): Promise<void> {
  const db = await getDb();
  if (systemSlug) {
    await db.query(
      "DELETE setting WHERE key = $key AND systemSlug = $systemSlug",
      { key, systemSlug },
    );
    return;
  }
  await db.query(
    "DELETE setting WHERE key = $key AND systemSlug IS NONE",
    { key },
  );
}

export async function batchUpsertSettings(
  items: { key: string; value: string; description: string; systemSlug?: string }[],
): Promise<void> {
  if (items.length === 0) return;
  const db = await getDb();
  const stmts = items.map((_, i) => {
    if (_.systemSlug) {
      return `UPSERT setting SET key = $k${i}, value = $v${i}, description = $d${i}, systemSlug = $s${i}, updatedAt = time::now() WHERE key = $k${i} AND systemSlug = $s${i}`;
    }
    return `UPSERT setting SET key = $k${i}, value = $v${i}, description = $d${i}, systemSlug = NONE, updatedAt = time::now() WHERE key = $k${i} AND systemSlug IS NONE`;
  });
  const bindings: Record<string, string> = {};
  items.forEach((item, i) => {
    bindings[`k${i}`] = item.key;
    bindings[`v${i}`] = item.value;
    bindings[`d${i}`] = item.description;
    if (item.systemSlug) bindings[`s${i}`] = item.systemSlug;
  });
  await db.query(stmts.join("; "), bindings);
}
