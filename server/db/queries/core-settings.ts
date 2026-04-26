import { getDb, rid } from "../connection.ts";
import type { CoreSetting } from "@/src/contracts/core-settings";
import type { System } from "@/src/contracts/system";
import type { Role } from "@/src/contracts/role";
import type { Plan } from "@/src/contracts/plan";
import type { MenuItem } from "@/src/contracts/menu";
import type { Voucher } from "@/src/contracts/voucher";
import type { Subscription } from "@/src/contracts/billing";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("core-settings");

/**
 * Settings are keyed by (key, tenantId). The tenantId references a system-level
 * tenant row. The core system's tenant is the core-level default; any other
 * system's tenant is a per-system override.
 */
export async function listSettings(
  tenantId?: string,
): Promise<CoreSetting[]> {
  const db = await getDb();
  const bindings: Record<string, unknown> = {};

  let query = "SELECT * FROM setting";
  if (tenantId) {
    query += " WHERE tenantId = $tenantId";
    bindings.tenantId = rid(tenantId);
  }
  query += " ORDER BY key ASC";

  const result = await db.query<[CoreSetting[]]>(query, bindings);
  return result[0] ?? [];
}

export async function getSetting(
  key: string,
  tenantId?: string,
): Promise<CoreSetting | null> {
  const db = await getDb();
  const bindings: Record<string, unknown> = { key };

  let query = "SELECT * FROM setting WHERE key = $key";
  if (tenantId) {
    query += " AND tenantId = $tenantId";
    bindings.tenantId = rid(tenantId);
  }
  query += " LIMIT 1";

  const result = await db.query<[CoreSetting[]]>(query, bindings);
  return result[0]?.[0] ?? null;
}

export async function upsertSetting(data: {
  key: string;
  value: string;
  description: string;
  tenantId?: string;
}): Promise<CoreSetting> {
  const db = await getDb();
  const bindings: Record<string, unknown> = {
    key: data.key,
    value: data.value,
    description: data.description,
  };

  let whereClause = "WHERE key = $key";
  if (data.tenantId) {
    bindings.tenantId = rid(data.tenantId);
    whereClause += " AND tenantId = $tenantId";
  }

  const result = await db.query<[CoreSetting[]]>(
    `UPSERT setting SET
      key = $key,
      value = $value,
      description = $description,
      updatedAt = time::now()
    ${whereClause}`,
    bindings,
  );
  return result[0][0];
}

export async function deleteSetting(
  key: string,
  tenantId?: string,
): Promise<void> {
  const db = await getDb();
  const bindings: Record<string, unknown> = { key };

  let query = "DELETE setting WHERE key = $key";
  if (tenantId) {
    query += " AND tenantId = $tenantId";
    bindings.tenantId = rid(tenantId);
  }

  await db.query(query, bindings);
}

export async function batchUpsertSettings(
  items: {
    key: string;
    value: string;
    description: string;
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
    bindings[`d${i}`] = item.description;
    const tKey = `t${i}`;
    bindings[tKey] = item.tenantId ?? "core";
    stmts.push(
      `UPSERT setting SET key = $k${i}, value = $v${i}, description = $d${i}, tenantId = $${tKey}, updatedAt = time::now() WHERE key = $k${i} AND tenantId = $${tKey}`,
    );
  });
  await db.query(stmts.join("; "), bindings);
}

/**
 * Fetches all core entities (systems, roles, plans, menus, settings, vouchers)
 * in a single batched query for cache hydration.
 */
export async function fetchAllCoreData(): Promise<
  [System[], Role[], Plan[], MenuItem[], CoreSetting[], Voucher[]]
> {
  const db = await getDb();
  return db.query<
    [System[], Role[], Plan[], MenuItem[], CoreSetting[], Voucher[]]
  >(
    `SELECT * FROM system;
    SELECT * FROM role;
    SELECT * FROM plan;
    SELECT * FROM menu_item ORDER BY sortOrder ASC;
    SELECT * FROM setting;
    SELECT * FROM voucher;`,
  );
}

/**
 * Fetches the active subscription for a tenant.
 */
export async function fetchActiveSubscription(params: {
  tenantId: string;
}): Promise<Subscription[]> {
  const db = await getDb();
  const result = await db.query<[Subscription[]]>(
    `SELECT * FROM subscription
     WHERE tenantId = $tenantId AND status = "active"
     LIMIT 1`,
    { tenantId: rid(params.tenantId) },
  );
  return result[0] ?? [];
}
