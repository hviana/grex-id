import { getDb, rid } from "../connection.ts";
import { getFS } from "@/server/utils/fs";
import FileCacheManager from "@/server/utils/file-cache";
import { assertServerOnly } from "../../utils/server-only.ts";
import { genericVerify } from "./generics.ts";

assertServerOnly("data-deletion");

/**
 * Deletes all data scoped to a tenant.
 * Does NOT delete the company or system records themselves.
 * All scoped tables use `tenantId` as the single scope key.
 */
export async function deleteTenantData(
  tenantId: string,
  companyId: string,
  systemSlug: string,
): Promise<void> {
  const db = await getDb();

  // Delete tenant-scoped data. All tables use tenantId.
  await db.query(
    `
    DELETE FROM subscription WHERE tenantId = $tenantId;
    DELETE FROM lead_company_system WHERE tenantId = $tenantId;
    DELETE FROM usage_record WHERE tenantId = $tenantId;
    DELETE FROM connected_app WHERE tenantId = $tenantId;
    DELETE FROM api_token WHERE tenantId = $tenantId;
    DELETE FROM credit_purchase WHERE tenantId = $tenantId;
    DELETE FROM credit_expense WHERE tenantId = $tenantId;
    DELETE FROM tag WHERE tenantId = $tenantId;
    DELETE FROM location WHERE tenantId = $tenantId;
    DELETE FROM tenant_role WHERE tenantId = $tenantId;
    DELETE FROM tenant WHERE id = $tenantId;
    `,
    { tenantId: rid(tenantId) },
  );

  // Delete all uploaded files under {companyId}/{systemSlug}/
  try {
    const fs = await getFS();
    await fs.deleteDir({ path: [companyId, systemSlug] });
  } catch {
    // If directory doesn't exist or fs fails, continue — data may not have files
  }

  FileCacheManager.getInstance().clearTenant(tenantId);
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
