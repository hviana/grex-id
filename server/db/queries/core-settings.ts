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

export interface SettingScope {
  systemId?: string;
  companyId?: string;
  actorId?: string;
}

/**
 * Constructs a scopeKey from scope components.
 * - No fields → "__core__" (core-level default)
 * - systemId only → "<systemId>"
 * - systemId + companyId → "<systemId>:<companyId>"
 * - systemId + companyId + actorId → "<systemId>:<companyId>:<actorId>"
 */
export function buildScopeKey(scope?: SettingScope): string {
  if (!scope) return "__core__";
  const parts: string[] = [];
  if (scope.systemId) parts.push(scope.systemId);
  if (scope.companyId) parts.push(scope.companyId);
  if (scope.actorId) parts.push(scope.actorId);
  return parts.length > 0 ? parts.join(":") : "__core__";
}

/**
 * Resolves a scopeKey to a tenant record ID by querying the tenant table
 * with the appropriate conditions. For "__core__", returns the core system-level
 * tenant record ID.
 */
export async function resolveTenantForScope(
  scopeKey: string,
): Promise<string | null> {
  const db = await getDb();

  if (scopeKey === "__core__") {
    const result = await db.query<[{ id: string }[]]>(
      `SELECT id FROM tenant
       WHERE actorId IS NONE AND companyId IS NONE
       AND systemId = (SELECT id FROM system WHERE slug = "core" LIMIT 1).id
       LIMIT 1`,
    );
    return result[0]?.[0]?.id ? String(result[0][0].id) : null;
  }

  const parts = scopeKey.split(":");
  const systemId = parts[0];
  const companyId = parts.length > 1 ? parts[1] : undefined;
  const actorId = parts.length > 2 ? parts[2] : undefined;

  let query = `SELECT id FROM tenant WHERE systemId = $systemId`;
  const bindings: Record<string, unknown> = { systemId: rid(systemId) };

  if (companyId) {
    query += ` AND companyId = $companyId`;
    bindings.companyId = rid(companyId);
  } else {
    query += ` AND companyId IS NONE`;
  }

  if (actorId) {
    query += ` AND actorId = $actorId`;
    bindings.actorId = rid(actorId);
  } else {
    query += ` AND actorId IS NONE`;
  }

  query += ` LIMIT 1`;

  const result = await db.query<[{ id: string }[]]>(query, bindings);
  return result[0]?.[0]?.id ? String(result[0][0].id) : null;
}

/**
 * Loads all settings for a given scopeKey into a Map<key, CoreSetting>.
 * Returns an empty map if no tenant row exists for the scope.
 */
export async function loadSettingsForScope(
  scopeKey: string,
): Promise<Map<string, CoreSetting>> {
  const tenantId = await resolveTenantForScope(scopeKey);
  const settings = new Map<string, CoreSetting>();

  if (!tenantId) return settings;

  const db = await getDb();
  const result = await db.query<[CoreSetting[]]>(
    `SELECT * FROM setting WHERE tenantIds CONTAINS $tenantId`,
    { tenantId: rid(tenantId) },
  );

  for (const setting of result[0] ?? []) {
    settings.set(setting.key, setting);
  }

  return settings;
}

/**
 * Returns the scopeKeys that should be walked for resolution, from most-specific
 * to least-specific, ending with "__core__".
 */
export function resolveScopeChain(scope?: SettingScope): string[] {
  const keys: string[] = [];

  if (scope?.actorId && scope?.companyId && scope?.systemId) {
    keys.push(buildScopeKey(scope));
  }
  if (scope?.companyId && scope?.systemId) {
    keys.push(
      buildScopeKey({ systemId: scope.systemId, companyId: scope.companyId }),
    );
  }
  if (scope?.systemId) {
    keys.push(buildScopeKey({ systemId: scope.systemId }));
  }
  keys.push("__core__");

  return keys;
}

export async function listSettings(
  scopeKey?: string,
): Promise<CoreSetting[]> {
  const db = await getDb();

  if (!scopeKey || scopeKey === "__core__") {
    const result = await db.query<[CoreSetting[]]>(
      `SELECT * FROM setting WHERE tenantIds CONTAINS (
        SELECT VALUE id FROM tenant
        WHERE actorId IS NONE AND companyId IS NONE
        AND systemId = (SELECT id FROM system WHERE slug = "core" LIMIT 1).id
        LIMIT 1
      )[0] ORDER BY key ASC`,
    );
    return result[0] ?? [];
  }

  const tenantId = await resolveTenantForScope(scopeKey);
  if (!tenantId) return [];

  const result = await db.query<[CoreSetting[]]>(
    `SELECT * FROM setting WHERE tenantIds CONTAINS $tenantId ORDER BY key ASC`,
    { tenantId: rid(tenantId) },
  );
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
    query += " AND tenantIds CONTAINS $tenantId";
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
  scopeKey?: string;
  tenantId?: string;
}): Promise<CoreSetting> {
  const db = await getDb();

  let effectiveTenantId = data.tenantId;
  if (!effectiveTenantId && data.scopeKey) {
    const resolved = await resolveTenantForScope(data.scopeKey);
    if (resolved) effectiveTenantId = resolved;
  }

  const bindings: Record<string, unknown> = {
    key: data.key,
    value: data.value,
    description: data.description,
  };

  let whereClause = "WHERE key = $key";
  if (effectiveTenantId) {
    bindings.tenantId = rid(effectiveTenantId);
    whereClause += " AND tenantIds CONTAINS $tenantId";
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
  scopeKey?: string,
  tenantId?: string,
): Promise<void> {
  const db = await getDb();

  let effectiveTenantId = tenantId;
  if (!effectiveTenantId && scopeKey) {
    const resolved = await resolveTenantForScope(scopeKey);
    if (resolved) effectiveTenantId = resolved;
  }

  const bindings: Record<string, unknown> = { key };

  let query = "DELETE setting WHERE key = $key";
  if (effectiveTenantId) {
    query += " AND tenantIds CONTAINS $tenantId";
    bindings.tenantId = rid(effectiveTenantId);
  }

  await db.query(query, bindings);
}

export async function batchUpsertSettings(
  items: {
    key: string;
    value: string;
    description: string;
    scopeKey?: string;
    tenantId?: string;
  }[],
): Promise<void> {
  if (items.length === 0) return;

  // Resolve tenantId for each item if scopeKey is provided
  const resolvedItems = await Promise.all(
    items.map(async (item) => {
      let effectiveTenantId = item.tenantId;
      if (!effectiveTenantId && item.scopeKey) {
        const resolved = await resolveTenantForScope(item.scopeKey);
        if (resolved) effectiveTenantId = resolved;
      }
      return { ...item, tenantId: effectiveTenantId };
    }),
  );

  const db = await getDb();
  const stmts: string[] = [];
  const bindings: Record<string, string> = {};
  resolvedItems.forEach((item, i) => {
    bindings[`k${i}`] = item.key;
    bindings[`v${i}`] = item.value;
    bindings[`d${i}`] = item.description;
    const tKey = `t${i}`;
    bindings[tKey] = item.tenantId ?? "__core__";
    if (item.tenantId) {
      stmts.push(
        `UPSERT setting SET key = $k${i}, value = $v${i}, description = $d${i}, tenantIds = [$${tKey}], updatedAt = time::now() WHERE key = $k${i} AND tenantIds CONTAINS $${tKey}`,
      );
    } else {
      // Core-level setting — use the core system tenant
      stmts.push(
        `UPSERT setting SET key = $k${i}, value = $v${i}, description = $d${i}, updatedAt = time::now() WHERE key = $k${i} AND array::len(tenantIds) = 0`,
      );
    }
  });
  await db.query(stmts.join("; "), bindings);
}

/**
 * Fetches core entities (systems, roles, plans, menus, vouchers)
 * in a single batched query for cache hydration.
 * Settings are excluded — they are loaded lazily per scope.
 */
export async function fetchAllCoreData(): Promise<
  [System[], Role[], Plan[], MenuItem[], Voucher[]]
> {
  const db = await getDb();
  return db.query<
    [System[], Role[], Plan[], MenuItem[], Voucher[]]
  >(
    `SELECT * FROM system;
    SELECT * FROM role;
    SELECT * FROM plan;
    SELECT * FROM menu_item ORDER BY sortOrder ASC;
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
     WHERE tenantIds CONTAINS $tenantId AND status = "active"
     LIMIT 1`,
    { tenantId: rid(params.tenantId) },
  );
  return result[0] ?? [];
}
