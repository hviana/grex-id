import { getDb } from "../connection.ts";
import type { FrontCoreSetting } from "@/src/contracts/core-settings";

function resolveScope(systemSlug?: string): string {
  return systemSlug && systemSlug.length > 0 ? systemSlug : "core";
}

export async function listFrontSettings(
  systemSlug?: string,
): Promise<FrontCoreSetting[]> {
  const db = await getDb();
  const scope = resolveScope(systemSlug);
  const result = await db.query<[FrontCoreSetting[]]>(
    "SELECT * FROM front_setting WHERE systemSlug = $systemSlug ORDER BY key ASC",
    { systemSlug: scope },
  );
  return result[0] ?? [];
}

export async function upsertFrontSetting(data: {
  key: string;
  value: string;
  description?: string;
  systemSlug?: string;
}): Promise<FrontCoreSetting> {
  const db = await getDb();
  const desc = data.description ?? "";
  const scope = resolveScope(data.systemSlug);
  const result = await db.query<[FrontCoreSetting[]]>(
    `UPSERT front_setting SET
      key = $key,
      value = $value,
      description = $description,
      systemSlug = $systemSlug,
      updatedAt = time::now()
    WHERE key = $key AND systemSlug = $systemSlug`,
    {
      key: data.key,
      value: data.value,
      description: desc,
      systemSlug: scope,
    },
  );
  return result[0][0];
}

export async function deleteFrontSetting(
  key: string,
  systemSlug?: string,
): Promise<void> {
  const db = await getDb();
  const scope = resolveScope(systemSlug);
  await db.query(
    "DELETE front_setting WHERE key = $key AND systemSlug = $systemSlug",
    { key, systemSlug: scope },
  );
}

export async function batchUpsertFrontSettings(
  items: {
    key: string;
    value: string;
    description?: string;
    systemSlug?: string;
  }[],
): Promise<void> {
  if (items.length === 0) return;
  const db = await getDb();
  const stmts = items.map(
    (_, i) =>
      `UPSERT front_setting SET key = $k${i}, value = $v${i}, description = $d${i}, systemSlug = $s${i}, updatedAt = time::now() WHERE key = $k${i} AND systemSlug = $s${i}`,
  );
  const bindings: Record<string, string> = {};
  items.forEach((item, i) => {
    bindings[`k${i}`] = item.key;
    bindings[`v${i}`] = item.value;
    bindings[`d${i}`] = item.description ?? "";
    bindings[`s${i}`] = resolveScope(item.systemSlug);
  });
  await db.query(stmts.join("; "), bindings);
}
