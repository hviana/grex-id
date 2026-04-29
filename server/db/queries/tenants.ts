import { getDb, rid } from "../connection.ts";
import type { TenantRow } from "@/src/contracts/high-level/query-results";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("tenants");

export type { TenantRow };

/**
 * Returns the core company-system tenant row (actorId=NONE, companyId NOT NONE).
 * Used by getSystemTenant() to construct the system-level Tenant.
 */
export async function fetchSystemTenantRow(
  systemId: string,
): Promise<TenantRow | null> {
  const db = await getDb();
  const [rows] = await db.query<[TenantRow[]]>(
    `SELECT id, companyId, systemId FROM tenant
     WHERE !actorId
       AND companyId
       AND systemId = $systemId
     LIMIT 1`,
    { systemId: rid(systemId) },
  );
  return rows?.[0] ? { ...rows[0] } : null;
}

/**
 * Returns the tenant row for a given company+system pair where actorId IS NONE.
 * This is the company-system link tenant row.
 */
export async function fetchCompanySystemTenantRow(
  companyId: string,
  systemId: string,
): Promise<TenantRow | null> {
  const db = await getDb();
  const [rows] = await db.query<[TenantRow[]]>(
    `SELECT id, companyId, systemId FROM tenant
     WHERE !actorId
       AND companyId = $companyId
       AND systemId = $systemId
     LIMIT 1`,
    { companyId: rid(companyId), systemId: rid(systemId) },
  );
  return rows?.[0] ? { ...rows[0] } : null;
}

/**
 * Resolves the FULL resource_limit for an actor (user or api_token).
 * Returns null if the actor or its resource_limit is not found.
 * Used by Core to cache actor-scoped limits and roles.
 */
export async function fetchActorResourceLimit(
  actorId: string,
): Promise<Record<string, unknown> | null> {
  const db = await getDb();
  const actorTable = actorId.startsWith("api_token:") ? "api_token" : "user";
  const result = await db.query<unknown[]>(
    `LET $rlId = (SELECT VALUE resourceLimitId FROM ${actorTable}
       WHERE id = $actorId LIMIT 1);
     SELECT * FROM ONLY resource_limit WHERE id = $rlId[0];`,
    { actorId: rid(actorId) },
  );
  return (result[result.length - 1] as Record<string, unknown>) ?? null;
}

/**
 * Resolves role names from a set of role record IDs.
 */
export async function resolveRoleNames(
  roleIds: string[],
): Promise<string[]> {
  if (!roleIds.length) return [];
  const db = await getDb();
  const result = await db.query<[string[]]>(
    `SELECT VALUE name FROM role WHERE id IN $roleIds;`,
    { roleIds: roleIds.map((id) => rid(id)) },
  );
  return result[0] ?? [];
}
