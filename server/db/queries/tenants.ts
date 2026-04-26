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
     WHERE actorId IS NONE
       AND companyId IS NOT NONE
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
     WHERE actorId IS NONE
       AND companyId = $companyId
       AND systemId = $systemId
     LIMIT 1`,
    { companyId: rid(companyId), systemId: rid(systemId) },
  );
  return rows?.[0] ? { ...rows[0] } : null;
}

/**
 * Fetches a tenant row by id along with its resolved role names and system slug.
 * All done in a single batched query.
 */
export async function fetchTenantWithRoles(tenantId: string): Promise<{
  row: TenantRow | null;
  roles: string[];
  systemSlug: string;
}> {
  const db = await getDb();
  const result = await db.query<
    [TenantRow[], { name: string }[], { slug: string }[]]
  >(
    `LET $t = (SELECT id, companyId, systemId, roleIds FROM ONLY $tenantId);
     SELECT VALUE name FROM role WHERE id IN $t.roleIds;
     SELECT slug FROM ONLY $t.systemId;`,
    { tenantId: rid(tenantId) },
  );

  const row = result[0]?.[0] ? { ...result[0][0] } : null;
  const roles = (result[1] ?? []).map((r) => r.name);
  const systemSlug = result[2]?.[0]?.slug ?? "";

  return { row, roles, systemSlug };
}
