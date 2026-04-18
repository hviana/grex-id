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
  const slug = systemSlug ?? null;
  const result = await db.query<[CoreSetting[]]>(
    "SELECT * FROM setting WHERE key = $key AND systemSlug = $systemSlug LIMIT 1",
    { key, systemSlug: slug },
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
  const slug = data.systemSlug ?? null;
  const result = await db.query<[CoreSetting[]]>(
    `UPSERT setting SET
      key = $key,
      value = $value,
      description = $description,
      systemSlug = $systemSlug,
      updatedAt = time::now()
    WHERE key = $key AND systemSlug = $systemSlug`,
    { ...data, systemSlug: slug },
  );
  return result[0][0];
}

export async function deleteSetting(
  key: string,
  systemSlug?: string,
): Promise<void> {
  const db = await getDb();
  const slug = systemSlug ?? null;
  await db.query("DELETE setting WHERE key = $key AND systemSlug = $systemSlug", {
    key,
    systemSlug: slug,
  });
}
