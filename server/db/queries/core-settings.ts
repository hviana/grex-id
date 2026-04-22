import { getDb } from "../connection.ts";
import type { CoreSetting } from "@/src/contracts/core-settings";

function resolveScope(systemSlug?: string): string {
  // systemSlug is NEVER empty at rest (DB ASSERT). "core" is the default scope;
  // any non-"core" value is a per-system override.
  return systemSlug && systemSlug.length > 0 ? systemSlug : "core";
}

export async function listSettings(
  systemSlug?: string,
): Promise<CoreSetting[]> {
  const db = await getDb();
  const scope = resolveScope(systemSlug);
  const result = await db.query<[CoreSetting[]]>(
    "SELECT * FROM setting WHERE systemSlug = $systemSlug ORDER BY key ASC",
    { systemSlug: scope },
  );
  return result[0] ?? [];
}

export async function getSetting(
  key: string,
  systemSlug?: string,
): Promise<CoreSetting | null> {
  const db = await getDb();
  const scope = resolveScope(systemSlug);
  const result = await db.query<[CoreSetting[]]>(
    "SELECT * FROM setting WHERE key = $key AND systemSlug = $systemSlug LIMIT 1",
    { key, systemSlug: scope },
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
  const scope = resolveScope(data.systemSlug);
  const result = await db.query<[CoreSetting[]]>(
    `UPSERT setting SET
      key = $key,
      value = $value,
      description = $description,
      systemSlug = $systemSlug,
      updatedAt = time::now()
    WHERE key = $key AND systemSlug = $systemSlug`,
    {
      key: data.key,
      value: data.value,
      description: data.description,
      systemSlug: scope,
    },
  );
  return result[0][0];
}

export async function deleteSetting(
  key: string,
  systemSlug?: string,
): Promise<void> {
  const db = await getDb();
  const scope = resolveScope(systemSlug);
  await db.query(
    "DELETE setting WHERE key = $key AND systemSlug = $systemSlug",
    { key, systemSlug: scope },
  );
}

export async function batchUpsertSettings(
  items: {
    key: string;
    value: string;
    description: string;
    systemSlug?: string;
  }[],
): Promise<void> {
  if (items.length === 0) return;
  const db = await getDb();
  const stmts = items.map(
    (_, i) =>
      `UPSERT setting SET key = $k${i}, value = $v${i}, description = $d${i}, systemSlug = $s${i}, updatedAt = time::now() WHERE key = $k${i} AND systemSlug = $s${i}`,
  );
  const bindings: Record<string, string> = {};
  items.forEach((item, i) => {
    bindings[`k${i}`] = item.key;
    bindings[`v${i}`] = item.value;
    bindings[`d${i}`] = item.description;
    bindings[`s${i}`] = resolveScope(item.systemSlug);
  });
  await db.query(stmts.join("; "), bindings);
}
