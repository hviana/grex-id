import type { Tenant } from "@/src/contracts/tenant.ts";
import Core from "./Core.ts";
import { assertServerOnly } from "./server-only.ts";
import { getDb } from "../db/connection.ts";

assertServerOnly("tenant.ts");

/**
 * System-level tenant for jobs and workers that operate without a user context.
 * Reads real core company and system IDs from the Core data cache.
 * Has superuser-level permissions.
 */
export async function getSystemTenant(): Promise<Tenant> {
  const core = Core.getInstance();
  const coreSystem = await core.getSystemBySlug("core");
  if (!coreSystem) {
    throw new Error(
      "[Tenant] Core system not found. Ensure seeds have been executed.",
    );
  }

  // Find the core company via company_system link
  const db = await getDb();
  const [rows] = await db.query<[{ companyId: string }[]]>(
    `SELECT companyId FROM company_system WHERE systemId = $systemId LIMIT 1`,
    { systemId: coreSystem.id },
  );
  const coreCompany = (rows ?? [])[0];
  if (!coreCompany) {
    throw new Error(
      "[Tenant] Core company not found. Ensure seeds have been executed.",
    );
  }

  return {
    systemId: String(coreSystem.id),
    companyId: String(coreCompany.companyId),
    systemSlug: "core",
    roles: ["superuser"],
    permissions: ["*"],
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
