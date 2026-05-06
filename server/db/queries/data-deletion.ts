import "server-only";

import { getFS } from "@/server/utils/fs";
import FileCacheManager from "@/server/utils/file-cache";
import { genericDelete } from "./generics.ts";
import type { Tenant } from "@/src/contracts/tenant";

const tenantCascadeTables = [
  "subscription",
  "usage_record",
  "api_token",
  "credit_purchase",
  "tag",
  "location",
] as const;

const tenantCascade = tenantCascadeTables.map((table) => ({
  table,
  parentField: "tenantIds" as const,
}));

/**
 * Deletes all data scoped to a tenant.
 * Does NOT delete the company or system records themselves.
 * All scoped tables use `tenantIds` as the scope key (array of tenant record IDs).
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
      cascade: tenantCascade,
    },
    tenant.id!,
  );

  // Delete all uploaded files under {companyId}/{systemSlug}/
  try {
    const fs = await getFS();
    await fs.deleteDir({ path: [companyId, systemSlug] });
  } catch {
    // If directory doesn't exist or fs fails, continue — data may not have files
  }

  FileCacheManager.getInstance().clearTenant(tenant.id!);
}
