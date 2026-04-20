import { getDb, rid } from "@/server/db/connection";
import {
  clearCache,
  getCache,
  registerCache,
  updateCache,
} from "@/server/utils/cache";

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

const SLUG = "grex-id";

function settingsCacheName(companyId: string, systemId: string): string {
  return `settings:${companyId}:${systemId}`;
}

async function loadSettings(
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

export function registerSettingsCache(
  companyId: string,
  systemId: string,
): void {
  const name = settingsCacheName(companyId, systemId);
  registerCache(SLUG, name, () => loadSettings(companyId, systemId));
}

async function getOrRegisterSettingsCache(
  companyId: string,
  systemId: string,
): Promise<Record<string, string>> {
  const name = settingsCacheName(companyId, systemId);
  try {
    return await getCache<Record<string, string>>(SLUG, name);
  } catch {
    registerSettingsCache(companyId, systemId);
    return getCache<Record<string, string>>(SLUG, name);
  }
}

export async function getSetting(
  companyId: string,
  systemId: string,
  key: string,
): Promise<string> {
  const settings = await getOrRegisterSettingsCache(companyId, systemId);
  return settings[key] ?? DEFAULTS[key] ?? "";
}

export async function getAllSettings(
  companyId: string,
  systemId: string,
): Promise<Record<string, string>> {
  return getOrRegisterSettingsCache(companyId, systemId);
}

export function invalidateSettingsCache(
  companyId: string,
  systemId: string,
): void {
  const name = settingsCacheName(companyId, systemId);
  clearCache(SLUG, name);
}

export async function upsertSetting(
  companyId: string,
  systemId: string,
  key: string,
  value: string,
): Promise<void> {
  const db = await getDb();
  await db.query(
    `UPSERT grexid_setting SET
      companyId = $cid,
      systemId = $sid,
      key = $k,
      value = $v
    WHERE companyId = $cid AND systemId = $sid AND key = $k`,
    { cid: rid(companyId), sid: rid(systemId), k: key, v: value },
  );
  const name = settingsCacheName(companyId, systemId);
  try {
    await updateCache(SLUG, name);
  } catch {
    registerSettingsCache(companyId, systemId);
  }
}

export async function upsertSettings(
  companyId: string,
  systemId: string,
  settings: Record<string, string>,
): Promise<Record<string, string>> {
  const entries = Object.entries(settings);
  if (entries.length === 0) {
    return getOrRegisterSettingsCache(companyId, systemId);
  }

  // Single batched query — builds one UPSERT per entry (§7.2)
  // Use index-based variable names to avoid key collision (e.g. "a.b" vs "a-b")
  const statements: string[] = [];
  const bindings: Record<string, unknown> = {
    cid: rid(companyId),
    sid: rid(systemId),
  };

  for (let i = 0; i < entries.length; i++) {
    const [key, value] = entries[i];
    bindings[`k_${i}`] = key;
    bindings[`v_${i}`] = value;
    statements.push(
      `UPSERT grexid_setting SET
        companyId = $cid,
        systemId = $sid,
        key = $k_${i},
        value = $v_${i}
      WHERE companyId = $cid AND systemId = $sid AND key = $k_${i}`,
    );
  }

  const db = await getDb();
  await db.query(statements.join(";\n"), bindings);

  const name = settingsCacheName(companyId, systemId);
  try {
    await updateCache(SLUG, name);
  } catch {
    registerSettingsCache(companyId, systemId);
  }
  return getOrRegisterSettingsCache(companyId, systemId);
}
