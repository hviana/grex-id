import "server-only";

import { getDb, rid } from "../connection.ts";
import type { TenantRow } from "@/src/contracts/high-level/query-results";

export type { TenantRow };

/**
 * Returns the core company-system tenant row:
 *
 * - actorId = NONE
 * - companyId != NONE
 * - systemId = provided system
 *
 * Avoid truthy/falsy SurrealQL checks like `!actorId` or `companyId`.
 * They are shorter, but fragile for production and security-sensitive tenant logic.
 */
export async function fetchSystemTenantRow(
  systemId: string,
): Promise<TenantRow | null> {
  const db = await getDb();

  const result = await db.query<unknown[]>(
    `SELECT id, companyId, systemId
     FROM tenant
     WHERE actorId = NONE
       AND companyId != NONE
       AND systemId = $systemId
     LIMIT 1`,
    { systemId: rid(systemId) },
  );

  const rows = result.at(-1) as TenantRow[] | undefined;

  return rows?.[0] ? { ...rows[0] } : null;
}

/**
 * Returns the tenant row for a given company+system pair where actorId = NONE.
 *
 * This is the company-system link tenant row.
 */
export async function fetchCompanySystemTenantRow(
  companyId: string,
  systemId: string,
): Promise<TenantRow | null> {
  const db = await getDb();

  const result = await db.query<unknown[]>(
    `SELECT id, companyId, systemId
     FROM tenant
     WHERE actorId = NONE
       AND companyId = $companyId
       AND systemId = $systemId
     LIMIT 1`,
    { companyId: rid(companyId), systemId: rid(systemId) },
  );

  const rows = result.at(-1) as TenantRow[] | undefined;

  return rows?.[0] ? { ...rows[0] } : null;
}

/**
 * Resolves the FULL resource_limit for an actor, either user or api_token.
 *
 * Returns null if the actor or its resource_limit is not found.
 * Used by Core to cache actor-scoped limits and roles.
 */
export async function fetchActorResourceLimit(
  actorId: string,
): Promise<Record<string, unknown> | null> {
  const db = await getDb();

  const actorTable = actorId.startsWith("api_token:") ? "api_token" : "user";

  const result = await db.query<unknown[]>(
    `LET $rlId = (
       SELECT VALUE resourceLimitId
       FROM ${actorTable}
       WHERE id = $actorId
       LIMIT 1
     )[0];

     SELECT *
     FROM resource_limit
     WHERE id = $rlId
     LIMIT 1;`,
    { actorId: rid(actorId) },
  );

  const rows = result.at(-1) as Record<string, unknown>[] | undefined;

  return rows?.[0] ? { ...rows[0] } : null;
}

/**
 * Returns the system-level tenant row:
 *
 * - actorId = NONE
 * - companyId = NONE
 * - systemId = provided system
 *
 * Creates it if it does not exist.
 *
 * Important:
 * The final statement is always a SELECT, and the TypeScript code reads
 * result.at(-1). This avoids depending on the position of LET/IF/CREATE
 * statement outputs in db.query().
 */
export async function fetchOrCreateSystemLevelTenantRow(
  systemId: string,
): Promise<TenantRow | null> {
  const db = await getDb();

  const result = await db.query<unknown[]>(
    `LET $existingId = (
       SELECT VALUE id
       FROM tenant
       WHERE actorId = NONE
         AND companyId = NONE
         AND systemId = $systemId
       LIMIT 1
     )[0];

     LET $created = IF $existingId = NONE THEN
       CREATE tenant SET
         actorId = NONE,
         companyId = NONE,
         systemId = $systemId
     ELSE
       []
     END;

     LET $targetId = IF $existingId != NONE THEN
       $existingId
     ELSE
       $created[0].id
     END;

     SELECT id, companyId, systemId
     FROM tenant
     WHERE id = $targetId
     LIMIT 1;`,
    { systemId: rid(systemId) },
  );

  const rows = result.at(-1) as TenantRow[] | undefined;

  return rows?.[0] ? { ...rows[0] } : null;
}

/**
 * Resolves role names from a set of role record IDs.
 */
export async function resolveRoleNames(
  roleIds: string[],
): Promise<string[]> {
  if (!roleIds.length) return [];

  const db = await getDb();

  const result = await db.query<unknown[]>(
    `SELECT VALUE name
     FROM role
     WHERE id IN $roleIds;`,
    { roleIds: roleIds.map((id) => rid(id)) },
  );

  return (result.at(-1) as string[] | undefined) ?? [];
}
