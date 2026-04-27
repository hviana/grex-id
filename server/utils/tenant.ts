import type { Tenant } from "@/src/contracts/tenant.ts";
import Core from "./Core.ts";
import { assertServerOnly } from "./server-only.ts";
import { fetchSystemTenantRow } from "../db/queries/tenants.ts";

assertServerOnly("tenant.ts");

/**
 * System-level tenant for jobs and workers that operate without a user context.
 * Returns the core company-system tenant row ID. No systemSlug or roles on the
 * Tenant contract — those are resolved on demand via Core cache.
 */
export async function getSystemTenant(): Promise<Tenant> {
  const core = Core.getInstance();
  const coreSystem = await core.getSystemBySlug("core");
  if (!coreSystem) {
    throw new Error(
      "[Tenant] Core system not found. Ensure seeds have been executed.",
    );
  }

  const tenantRow = await fetchSystemTenantRow(coreSystem.id);
  if (!tenantRow) {
    throw new Error(
      "[Tenant] Core company-system tenant not found. Ensure seeds have been executed.",
    );
  }

  return {
    id: String(tenantRow.id),
    systemId: String(tenantRow.systemId),
    companyId: String(tenantRow.companyId),
    actorId: undefined,
    isOwner: undefined,
    createdAt: "",
    updatedAt: "",
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
