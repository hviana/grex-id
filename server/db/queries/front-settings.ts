import { getDb } from "../connection.ts";
import type { FrontCoreSetting } from "@/src/contracts/core-settings";

export async function listFrontSettings(
  systemSlug?: string,
): Promise<FrontCoreSetting[]> {
  const db = await getDb();
  if (systemSlug) {
    const result = await db.query<[FrontCoreSetting[]]>(
      "SELECT * FROM front_setting WHERE systemSlug = $systemSlug ORDER BY key ASC",
      { systemSlug },
    );
    return result[0] ?? [];
  }
  const result = await db.query<[FrontCoreSetting[]]>(
    "SELECT * FROM front_setting WHERE systemSlug IS NONE ORDER BY key ASC",
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
  const slug = data.systemSlug ?? null;
  const result = await db.query<[FrontCoreSetting[]]>(
    `UPSERT front_setting SET
      key = $key,
      value = $value,
      description = $description,
      systemSlug = $systemSlug,
      updatedAt = time::now()
    WHERE key = $key AND systemSlug = $systemSlug`,
    { ...data, systemSlug: slug, description: data.description ?? "" },
  );
  return result[0][0];
}

export async function deleteFrontSetting(
  key: string,
  systemSlug?: string,
): Promise<void> {
  const db = await getDb();
  const slug = systemSlug ?? null;
  await db.query(
    "DELETE front_setting WHERE key = $key AND systemSlug = $systemSlug",
    { key, systemSlug: slug },
  );
}
