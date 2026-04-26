import { getDb, rid } from "../connection.ts";
import type { FrontCoreSetting } from "@/src/contracts/core-settings";
import {
  buildScopeKey,
  resolveTenantForScope,
  type SettingScope,
} from "./core-settings";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("front-settings");

/**
 * Loads all front_setting rows for a given scopeKey into a Map<key, FrontCoreSetting>.
 * Returns an empty map if no tenant row exists for the scope.
 */
export async function loadFrontSettingsForScope(
  scopeKey: string,
): Promise<Map<string, FrontCoreSetting>> {
  const tenantId = await resolveTenantForScope(scopeKey);
  const settings = new Map<string, FrontCoreSetting>();

  if (!tenantId) return settings;

  const db = await getDb();
  const result = await db.query<[FrontCoreSetting[]]>(
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
): Promise<FrontCoreSetting[]> {
  const db = await getDb();

  if (!scopeKey || scopeKey === "__core__") {
    const result = await db.query<[FrontCoreSetting[]]>(
      `SELECT * FROM front_setting WHERE tenantIds CONTAINS (
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

  const result = await db.query<[FrontCoreSetting[]]>(
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
        `UPSERT front_setting SET key = $k${i}, value = $v${i}, description = $d${i}, tenantIds = [$${tKey}], updatedAt = time::now() WHERE key = $k${i} AND tenantIds CONTAINS $${tKey}`,
      );
    } else {
      stmts.push(
        `UPSERT front_setting SET key = $k${i}, value = $v${i}, description = $d${i}, updatedAt = time::now() WHERE key = $k${i} AND array::len(tenantIds) = 0`,
      );
    }
  });
  await db.query(stmts.join("; "), bindings);
}
