import { getDb, rid } from "../connection.ts";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("tenants");

export interface TenantRow {
  id: string;
  companyId: string;
  systemId: string;
  roleIds?: string[];
}

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
 * Resolves role names from a tenant's roleIds array.
 * Used by Core.getTenantRoles() for user-type actors.
 */
export async function resolveTenantRoleNames(
  tenantId: string,
): Promise<string[]> {
  const db = await getDb();
  const result = await db.query<[string[]]>(
    `LET $t = (SELECT roleIds FROM $tenantId LIMIT 1)[0];
     SELECT VALUE name FROM role WHERE id IN $t.roleIds;`,
    { tenantId: rid(tenantId) },
  );
  return result[0] ?? [];
}

/**
 * Fetches the full resource_limit for an api_token actor.
 * Used by Core to resolve actor-scoped limits.
 */
export async function fetchApiTokenResourceLimit(
  actorId: string,
): Promise<Record<string, unknown> | null> {
  const db = await getDb();
  const result = await db.query<[Record<string, unknown>[]]>(
    `SELECT * FROM ONLY $actorId FETCH resourceLimitId;`,
    { actorId: rid(actorId) },
  );
  const row = result[0]?.[0];
  if (!row) return null;
  const rl = row.resourceLimitId as Record<string, unknown> | undefined;
  return rl ?? null;
}
