import { getDb, normalizeRecordId, rid } from "@/server/db/connection";
import { assertServerOnly } from "../../../../utils/server-only.ts";

assertServerOnly("grex-id/companies");

/**
 * Search companies that the user belongs to and that are subscribed to the
 * given system, filtering by name. Used by the grex-id companies dropdown
 * on the authenticated system panel.
 */
export async function searchUserCompaniesBySystem(params: {
  systemSlug: string;
  userId: string;
  search: string;
}): Promise<{ id: string; label: string }[]> {
  const db = await getDb();
  const result = await db.query<
    [{ id: string; companyId: { id: string; name: string } }[]]
  >(
    `LET $sys = (SELECT id FROM system WHERE slug = $systemSlug LIMIT 1);
     SELECT companyId FROM company_system
     WHERE systemId = $sys[0].id
       AND companyId INSIDE (SELECT VALUE companyId FROM company_user WHERE userId = $userId)
       AND companyId.name @@ $search
     LIMIT 20
     FETCH companyId`,
    {
      systemSlug: params.systemSlug,
      userId: params.userId,
      search: params.search,
    },
  );

  const rows = result[0] ?? [];
  return rows
    .map((row) => {
      const company = row.companyId as
        | { id: string; name: string }
        | undefined;
      if (!company?.id) return null;
      return {
        id: normalizeRecordId(company.id) ?? company.id,
        label: company.name,
      };
    })
    .filter((item): item is { id: string; label: string } => item !== null);
}
