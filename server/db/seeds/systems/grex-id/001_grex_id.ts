import type { Surreal } from "surrealdb";
import { assertServerOnly } from "../../../../utils/server-only.ts";

assertServerOnly("001_grex_id");

export async function seed(db: Surreal): Promise<void> {
  const existing = await db.query<[{ id: string }[]]>(
    `SELECT id FROM system WHERE slug = "grex-id" LIMIT 1`,
  );
  if ((existing[0] ?? []).length > 0) {
    console.log("[seed] grex-id infrastructure already exists, skipping");
    return;
  }

  // 1. Create the GrexID system
  const systemResult = await db.query<[{ id: string }[]]>(
    `CREATE system SET
      name = $name,
      slug = $slug,
      logoUri = ""`,
    { name: "GrexID", slug: "grex-id" },
  );
  const systemId = systemResult[0][0].id;
  console.log("[seed] system created: GrexID (grex-id)");

  // 2. Create system-level tenant row for grex-id (actorId=NONE, companyId=NONE)
  const tenantResult = await db.query<[{ id: string }[]]>(
    `CREATE tenant SET
       actorId = NONE,
       companyId = NONE,
       systemId = $systemId`,
    { systemId },
  );
  const systemTenantId = tenantResult[0][0].id;
  console.log("[seed] system-level tenant created for grex-id");

  // 3. Create the admin role for GrexID linked to system-level tenant
  const adminRoleResult = await db.query<[{ id: string }[]]>(
    `IF array::len((SELECT id FROM role WHERE name = "admin" AND tenantIds CONTAINS $systemTenantId)) = 0 {
       CREATE role SET
         name = "admin",
         tenantIds = [$systemTenantId],
         isBuiltIn = true
     };
     SELECT id FROM role WHERE name = "admin" AND tenantIds CONTAINS $systemTenantId`,
    { systemTenantId },
  );
  const adminRoleId = adminRoleResult[0]?.[0]?.id;
  if (!adminRoleId) {
    throw new Error("[seed] failed to create admin role for grex-id");
  }
  console.log("[seed] role created: admin for grex-id");

  // 4. Create plan-specific roles for grex-id
  const planRolesResult = await db.query<[{ id: string }[]]>(
    `IF array::len((SELECT id FROM role WHERE name = "grexid.detect" AND tenantIds CONTAINS $systemTenantId)) = 0 {
       CREATE role SET
         name = "grexid.detect",
         tenantIds = [$systemTenantId],
         isBuiltIn = false
     };
     IF array::len((SELECT id FROM role WHERE name = "grexid.list_locations" AND tenantIds CONTAINS $systemTenantId)) = 0 {
       CREATE role SET
         name = "grexid.list_locations",
         tenantIds = [$systemTenantId],
         isBuiltIn = false
     };
     SELECT id FROM role WHERE name IN ["grexid.detect", "grexid.list_locations"] AND tenantIds CONTAINS $systemTenantId`,
    { systemTenantId },
  );
  const planRoleIds = [...planRolesResult[0].map((r) => r.id), adminRoleId];
  console.log("[seed] plan roles created for grex-id");

  // 5. Create the STANDARD plan with linked resource_limit
  await db.query(
    `LET $rl = CREATE resource_limit SET
      benefits = [],
      roleIds = $roleIds,
      apiRateLimit = 1000,
      storageLimitBytes = 1073741824,
      fileCacheLimitBytes = 20971520,
      credits = 0;
    CREATE plan SET
      name = $name,
      description = $description,
      tenantIds = [$systemTenantId],
      price = $price,
      currency = $currency,
      recurrenceDays = $recurrenceDays,
      isActive = true,
      resourceLimitId = $rl[0].id`,
    {
      name: "plans.grexId.standard.name",
      description: "plans.grexId.standard.description",
      systemTenantId,
      price: 0,
      currency: "USD",
      recurrenceDays: 30,
      roleIds: planRoleIds,
    },
  );
  console.log("[seed] plan created: STANDARD for grex-id");
}
