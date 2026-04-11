import { getDb, rid } from "../connection";
import type { CoreSetting } from "@/src/contracts/core-settings";

export async function listSettings(): Promise<CoreSetting[]> {
  const db = await getDb();
  const result = await db.query<[CoreSetting[]]>(
    "SELECT * FROM core_setting ORDER BY key ASC",
  );
  return result[0] ?? [];
}

export async function getSetting(key: string): Promise<CoreSetting | null> {
  const db = await getDb();
  const result = await db.query<[CoreSetting[]]>(
    "SELECT * FROM core_setting WHERE key = $key LIMIT 1",
    { key },
  );
  return result[0]?.[0] ?? null;
}

export async function upsertSetting(data: {
  key: string;
  value: string;
  description: string;
}): Promise<CoreSetting> {
  const db = await getDb();
  const result = await db.query<[CoreSetting[]]>(
    `UPSERT core_setting SET
      key = $key,
      value = $value,
      description = $description,
      updatedAt = time::now()
    WHERE key = $key`,
    data,
  );
  return result[0][0];
}

export async function deleteSetting(key: string): Promise<void> {
  const db = await getDb();
  await db.query("DELETE core_setting WHERE key = $key", { key });
}
