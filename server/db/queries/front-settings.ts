import { getDb, rid } from "../connection.ts";
import type { FrontCoreSetting } from "@/src/contracts/core-settings";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("front-settings");

/**
 * Front settings are keyed by (key, tenantId). The tenantId references a
 * system-level tenant row. Same shape as `setting` but physically separate
 * table so the frontend bundle cannot leak server secrets.
 */
export async function listFrontSettings(
  tenantId?: string,
): Promise<FrontCoreSetting[]> {
  const db = await getDb();
  const bindings: Record<string, unknown> = {};

  let query = "SELECT * FROM front_setting";
  if (tenantId) {
    query += " WHERE tenantId = $tenantId";
    bindings.tenantId = rid(tenantId);
  }
  query += " ORDER BY key ASC";

  const result = await db.query<[FrontCoreSetting[]]>(query, bindings);
  return result[0] ?? [];
}

export async function upsertFrontSetting(data: {
  key: string;
  value: string;
  description?: string;
  tenantId?: string;
}): Promise<FrontCoreSetting> {
  const db = await getDb();
  const desc = data.description ?? "";
  const bindings: Record<string, unknown> = {
    key: data.key,
    value: data.value,
    description: desc,
  };

  let whereClause = "WHERE key = $key";
  if (data.tenantId) {
    bindings.tenantId = rid(data.tenantId);
    whereClause += " AND tenantId = $tenantId";
  }

  const result = await db.query<[FrontCoreSetting[]]>(
    `UPSERT front_setting SET
      key = $key,
      value = $value,
      description = $description,
      updatedAt = time::now()
    ${whereClause}`,
    bindings,
  );
  return result[0][0];
}

export async function deleteFrontSetting(
  key: string,
  tenantId?: string,
): Promise<void> {
  const db = await getDb();
  const bindings: Record<string, unknown> = { key };

  let query = "DELETE front_setting WHERE key = $key";
  if (tenantId) {
    query += " AND tenantId = $tenantId";
    bindings.tenantId = rid(tenantId);
  }

  await db.query(query, bindings);
}

export async function batchUpsertFrontSettings(
  items: {
    key: string;
    value: string;
    description?: string;
    tenantId?: string;
  }[],
): Promise<void> {
  if (items.length === 0) return;
  const db = await getDb();
  const stmts: string[] = [];
  const bindings: Record<string, string> = {};
  items.forEach((item, i) => {
    bindings[`k${i}`] = item.key;
    bindings[`v${i}`] = item.value;
    bindings[`d${i}`] = item.description ?? "";
    const tKey = `t${i}`;
    bindings[tKey] = item.tenantId ?? "core";
    stmts.push(
      `UPSERT front_setting SET key = $k${i}, value = $v${i}, description = $d${i}, tenantId = $${tKey}, updatedAt = time::now() WHERE key = $k${i} AND tenantId = $${tKey}`,
    );
  });
  await db.query(stmts.join("; "), bindings);
}

/**
 * Fetches all front_setting rows for cache hydration.
 */
export async function fetchAllFrontSettings(): Promise<FrontCoreSetting[]> {
  const db = await getDb();
  const results = await db.query<[FrontCoreSetting[]]>(
    "SELECT * FROM front_setting;",
  );
  return results[0] ?? [];
}
