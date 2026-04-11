import { getDb, rid } from "@/server/db/connection";

export interface GrexIdSetting {
  id: string;
  companyId: string;
  systemId: string;
  key: string;
  value: string;
  createdAt: string;
  updatedAt: string;
}

const DEFAULTS: Record<string, string> = {
  "detection.sensitivity": "0.5",
};

export async function getSetting(
  companyId: string,
  systemId: string,
  key: string,
): Promise<string> {
  const db = await getDb();
  const result = await db.query<[GrexIdSetting[]]>(
    `SELECT * FROM grexid_setting
     WHERE companyId = $companyId AND systemId = $systemId AND key = $key
     LIMIT 1`,
    { companyId: rid(companyId), systemId: rid(systemId), key },
  );
  return result[0]?.[0]?.value ?? DEFAULTS[key] ?? "";
}

export async function getAllSettings(
  companyId: string,
  systemId: string,
): Promise<Record<string, string>> {
  const db = await getDb();
  const result = await db.query<[GrexIdSetting[]]>(
    `SELECT * FROM grexid_setting
     WHERE companyId = $companyId AND systemId = $systemId`,
    { companyId: rid(companyId), systemId: rid(systemId) },
  );

  const settings: Record<string, string> = { ...DEFAULTS };
  for (const row of result[0] ?? []) {
    settings[row.key] = row.value;
  }
  return settings;
}

export async function upsertSetting(
  companyId: string,
  systemId: string,
  key: string,
  value: string,
): Promise<void> {
  const db = await getDb();
  await db.query(
    `DELETE grexid_setting
      WHERE companyId = $cid AND systemId = $sid AND key = $k;
     CREATE grexid_setting SET
      companyId = $cid,
      systemId = $sid,
      key = $k,
      value = $v;`,
    { cid: rid(companyId), sid: rid(systemId), k: key, v: value },
  );
}

export async function upsertSettings(
  companyId: string,
  systemId: string,
  settings: Record<string, string>,
): Promise<Record<string, string>> {
  const db = await getDb();
  const entries = Object.entries(settings);
  if (entries.length === 0) return getAllSettings(companyId, systemId);

  for (const [key, value] of entries) {
    await db.query(
      `DELETE grexid_setting
        WHERE companyId = $cid AND systemId = $sid AND key = $k;
       CREATE grexid_setting SET
        companyId = $cid,
        systemId = $sid,
        key = $k,
        value = $v;`,
      { cid: rid(companyId), sid: rid(systemId), k: key, v: value },
    );
  }

  return getAllSettings(companyId, systemId);
}
