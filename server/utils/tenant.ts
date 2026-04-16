import type { Tenant } from "@/src/contracts/tenant.ts";

if (typeof window !== "undefined") {
  throw new Error("tenant.ts must not be imported in client-side code.");
}

/**
 * System-level tenant for jobs and workers that operate without a user context.
 * Has superuser-level permissions.
 */
export function getSystemTenant(): Tenant {
  return {
    systemId: "0",
    companyId: "0",
    systemSlug: "core",
    roles: ["superuser"],
    permissions: ["*"],
  };
}

/**
 * Anonymous tenant for unauthenticated requests.
 * All IDs are "0", no roles or permissions.
 */
export function getAnonymousTenant(systemSlug: string): Tenant {
  return {
    systemId: "0",
    companyId: "0",
    systemSlug,
    roles: [],
    permissions: [],
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
