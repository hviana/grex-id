import type { Surreal } from "surrealdb";
import { assertServerOnly } from "../../../../utils/server-only.ts";

assertServerOnly("001_grex_id");

export async function seed(db: Surreal): Promise<void> {
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

  // 2. Create the admin role for GrexID
  await db.query(
    `IF array::len((SELECT id FROM role WHERE name = "admin" AND systemId = $systemId)) = 0 {
       CREATE role SET
         name = "admin",
         systemId = $systemId,
         permissions = ["*"],
         isBuiltIn = true
     }`,
    { systemId },
  );
  console.log("[seed] role created: admin for grex-id");

  // 3. Create the STANDARD plan
  await db.query(
    `CREATE plan SET
      name = $name,
      description = $description,
      systemId = $systemId,
      price = $price,
      currency = $currency,
      recurrenceDays = $recurrenceDays,
      benefits = $benefits,
      permissions = $permissions,
      apiRateLimit = 1000,
      storageLimitBytes = 1073741824,
      fileCacheLimitBytes = 20971520,
      planCredits = 0,
      isActive = true`,
    {
      name: "plans.grexId.standard.name",
      description: "plans.grexId.standard.description",
      systemId,
      price: 0,
      currency: "USD",
      recurrenceDays: 30,
      benefits: [],
      permissions: ["grexid.detect", "grexid.list_locations"],
    },
  );
  console.log("[seed] plan created: STANDARD for grex-id");
}
