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
 * Fetches the active subscription for a company+system pair.
 */
export async function fetchActiveSubscription(params: {
  companyId: string;
  systemId: string;
}): Promise<Subscription[]> {
  const db = await getDb();
  const result = await db.query<[Subscription[]]>(
    `SELECT * FROM subscription
     WHERE companyId = $companyId AND systemId = $systemId AND status = "active"
     LIMIT 1`,
    { companyId: rid(params.companyId), systemId: rid(params.systemId) },
  );
  return result[0] ?? [];
}
