import "server-only";

import { getDb, rid } from "../connection.ts";
import type { FrontSetting } from "@/src/contracts/front-setting";
import { buildScopeKey, resolveTenantForScope } from "./core-settings";
import type { SettingScope } from "@/src/contracts/high-level/cache-data";

/**
 * Loads all front_setting rows for a given scopeKey into a Map<key, FrontSetting>.
 * Returns an empty map if no tenant row exists for the scope.
 */
export async function loadFrontSettingsForScope(
  scopeKey: string,
): Promise<Map<string, FrontSetting>> {
  const tenantId = await resolveTenantForScope(scopeKey);
  const settings = new Map<string, FrontSetting>();

  if (!tenantId) return settings;

  const db = await getDb();
  const result = await db.query<[FrontSetting[]]>(
    `SELECT * FROM front_setting WHERE tenantIds CONTAINS $tenantId`,
    { tenantId: rid(tenantId) },
  );

  for (const setting of result[0] ?? []) {
    settings.set(setting.key, setting);
  }

  return settings;
}

export async function listFrontSettings(
  scopeKey?: string,
): Promise<FrontSetting[]> {
  const db = await getDb();

  if (!scopeKey || scopeKey === "__core__") {
    const result = await db.query<[FrontSetting[]]>(
      `SELECT * FROM front_setting WHERE tenantIds CONTAINS (
        SELECT VALUE id FROM tenant
        WHERE !actorId AND !companyId AND systemId.slug = "core"
        LIMIT 1
      )[0] ORDER BY key ASC`,
    );
    return result[0] ?? [];
  }

  const tenantId = await resolveTenantForScope(scopeKey);
  if (!tenantId) return [];

  const result = await db.query<[FrontSetting[]]>(
    `SELECT * FROM front_setting WHERE tenantIds CONTAINS $tenantId ORDER BY key ASC`,
    { tenantId: rid(tenantId) },
  );
  return result[0] ?? [];
}

export async function deleteFrontSetting(
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
  if (!effectiveTenantId) {
    effectiveTenantId = await resolveTenantForScope("__core__") ?? undefined;
  }

  const bindings: Record<string, unknown> = { key };

  let query = "DELETE front_setting WHERE key = $key";
  if (effectiveTenantId) {
    query += " AND tenantIds CONTAINS $tenantId";
    bindings.tenantId = rid(effectiveTenantId);
  }

  await db.query(query, bindings);
}

export async function batchUpsertFrontSettings(
  items: {
    key: string;
    value: string;
    description?: string;
    scopeKey?: string;
    tenantId?: string;
  }[],
): Promise<void> {
  if (items.length === 0) return;

  const resolvedItems = await Promise.all(
    items.map(async (item) => {
      let effectiveTenantId = item.tenantId;
      if (!effectiveTenantId && item.scopeKey) {
        const resolved = await resolveTenantForScope(item.scopeKey);
        if (resolved) effectiveTenantId = resolved;
      }
      if (!effectiveTenantId) {
        effectiveTenantId = await resolveTenantForScope("__core__") ??
          undefined;
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
    bindings[`d${i}`] = item.description ?? "";
    const tKey = `t${i}`;
    bindings[tKey] = item.tenantId ?? "__core__";
    if (item.tenantId) {
      stmts.push(
        `UPSERT front_setting SET key = $k${i}, value = $v${i}, description = $d${i}, tenantIds = {$${tKey}}, updatedAt = time::now() WHERE key = $k${i} AND tenantIds CONTAINS $${tKey}`,
      );
    } else {
      stmts.push(
        `UPSERT front_setting SET key = $k${i}, value = $v${i}, description = $d${i}, updatedAt = time::now() WHERE key = $k${i} AND set::len(tenantIds) = 0`,
      );
    }
  });
  await db.query(stmts.join("; "), bindings);
}
