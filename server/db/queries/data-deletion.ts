import { getDb, rid } from "../connection.ts";
import { getFS } from "@/server/utils/fs";
import FileCacheManager from "@/server/utils/file-cache";
import { assertServerOnly } from "../../utils/server-only.ts";
import { genericVerify } from "./generics.ts";

assertServerOnly("data-deletion");

/**
 * Deletes all data scoped to a company+system pair.
 * Does NOT delete the company or system records themselves.
 */
export async function deleteCompanySystemData(
  companyId: string,
  systemId: string,
  systemSlug: string,
): Promise<void> {
  const db = await getDb();

  // Delete association tables and scoped data
  await db.query(
    `
    DELETE FROM company_system WHERE companyId = $companyId AND systemId = $systemId;
    DELETE FROM user_company_system WHERE companyId = $companyId AND systemId = $systemId;
    DELETE FROM subscription WHERE companyId = $companyId AND systemId = $systemId;
    DELETE FROM lead_company_system WHERE companyId = $companyId AND systemId = $systemId;
    DELETE FROM usage_record WHERE companyId = $companyId AND systemId = $systemId;
    DELETE FROM connected_app WHERE companyId = $companyId AND systemId = $systemId;
    DELETE FROM api_token WHERE companyId = $companyId AND systemId = $systemId;
    DELETE FROM credit_purchase WHERE companyId = $companyId AND systemId = $systemId;
    DELETE FROM tag WHERE companyId = $companyId AND systemId = $systemId;
    `,
    { companyId: rid(companyId), systemId: rid(systemId) },
  );

  // Delete all uploaded files under {companyId}/{systemSlug}/
  try {
    const fs = await getFS();
    await fs.deleteDir({ path: [companyId, systemSlug] });
  } catch {
    // If directory doesn't exist or fs fails, continue — data may not have files
  }

  FileCacheManager.getInstance().clearTenant(`${companyId}:${systemSlug}`);
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
