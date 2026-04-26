import type { Tenant } from "@/src/contracts/tenant.ts";
import Core from "./Core.ts";
import { assertServerOnly } from "./server-only.ts";
import { getDb } from "../db/connection.ts";

assertServerOnly("tenant.ts");

/**
 * System-level tenant for jobs and workers that operate without a user context.
 * Returns the core company-system tenant row ID with the superuser role.
 */
export async function getSystemTenant(): Promise<Tenant> {
  const core = Core.getInstance();
  const coreSystem = await core.getSystemBySlug("core");
  if (!coreSystem) {
    throw new Error(
      "[Tenant] Core system not found. Ensure seeds have been executed.",
    );
  }

  // Find the core company-system tenant row (actorId=NONE)
  const db = await getDb();
  const [rows] = await db.query<
    [{ id: string; companyId: string; systemId: string }[]]
  >(
    `SELECT id, companyId, systemId FROM tenant WHERE actorId IS NONE AND companyId IS NOT NONE AND systemId = $systemId LIMIT 1`,
    { systemId: coreSystem.id },
  );
  const tenantRow = (rows ?? [])[0];
  if (!tenantRow) {
    throw new Error(
      "[Tenant] Core company-system tenant not found. Ensure seeds have been executed.",
    );
  }

  return {
    id: String(tenantRow.id),
    systemId: String(tenantRow.systemId),
    companyId: String(tenantRow.companyId),
    systemSlug: "core",
    roles: ["superuser"],
  };
}

/**
 * Resolve a tenant record by its ID, including roles from tenant.roleIds.
 */
export async function resolveTenant(tenantId: string): Promise<Tenant | null> {
  const db = await getDb();
  const result = await db.query<
    [{ id: string; companyId: string; systemId: string }[], { name: string }[]]
  >(
    `LET $t = (SELECT id, companyId, systemId, roleIds FROM tenant WHERE id = $tenantId LIMIT 1);
     IF $t[0] {
       SELECT VALUE name FROM role WHERE id IN $t[0].roleIds
     } ELSE {
       []
     }`,
    { tenantId },
  );

  const tenantRow = result[0]?.[0];
  if (!tenantRow) return null;

  const roles = (result[1] ?? []).map((r: { name: string }) => r.name);

  // Resolve systemSlug from system
  let systemSlug = "";
  if (tenantRow.systemId) {
    const sysResult = await db.query<[{ slug: string }[]]>(
      `SELECT slug FROM system WHERE id = $systemId LIMIT 1`,
      { systemId: tenantRow.systemId },
    );
    systemSlug = sysResult[0]?.[0]?.slug ?? "";
  }

  return {
    id: String(tenantRow.id),
    systemId: String(tenantRow.systemId ?? ""),
    companyId: String(tenantRow.companyId ?? ""),
    systemSlug,
    roles,
  };
}

/**
 * Asserts that the tenant satisfies the required scope.
 * Throws a Response (403) on mismatch.
 */
export function assertScope(
  tenant: Tenant,
  required: { companyId?: string; systemId?: string },
): void {
  if (required.companyId && tenant.companyId !== required.companyId) {
    throw new Response(
      JSON.stringify({
        success: false,
        error: { code: "FORBIDDEN", message: "common.error.scopeMismatch" },
      }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }
  if (required.systemId && tenant.systemId !== required.systemId) {
    throw new Response(
      JSON.stringify({
        success: false,
        error: { code: "FORBIDDEN", message: "common.error.scopeMismatch" },
      }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }
}
