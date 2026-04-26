import { getFS } from "@/server/utils/fs";
import FileCacheManager from "@/server/utils/file-cache";
import { assertServerOnly } from "../../utils/server-only.ts";
import { genericDelete, genericVerify } from "./generics.ts";
import type { Tenant } from "@/src/contracts/tenant";

assertServerOnly("data-deletion");

const tenantCascadeTables = [
  "subscription",
  "lead_company_system",
  "usage_record",
  "connected_app",
  "api_token",
  "credit_purchase",
  "credit_expense",
  "tag",
  "location",
  "tenant_role",
] as const;

/**
 * Deletes all data scoped to a tenant.
 * Does NOT delete the company or system records themselves.
 * All scoped tables use `tenantId` as the single scope key.
 */
export async function deleteTenantData(
  tenant: Tenant,
  companyId: string,
  systemSlug: string,
): Promise<void> {
  await genericDelete(
    {
      table: "tenant",
      tenant,
      cascade: tenantCascadeTables.map((table) => ({ table })),
    },
    tenant.id,
  );

  // Delete all uploaded files under {companyId}/{systemSlug}/
  try {
    const fs = await getFS();
    await fs.deleteDir({ path: [companyId, systemSlug] });
  } catch {
    // If directory doesn't exist or fs fails, continue — data may not have files
  }

  FileCacheManager.getInstance().clearTenant(tenant.id);
}

/**
 * Verifies a user's password against their stored hash using SurrealDB's
 * built-in crypto::argon2::compare().
 */
export async function verifyUserPassword(
  userId: string,
  password: string,
): Promise<boolean> {
  return genericVerify(
    { table: "user", hashField: "passwordHash" },
    userId,
    password,
  );
}
