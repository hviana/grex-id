import type { Surreal } from "surrealdb";

export async function seed(db: Surreal): Promise<void> {
  // 1. Create the GrexID system
  const existingSystem = await db.query<[{ id: string }[]]>(
    "SELECT id FROM system WHERE slug = $slug LIMIT 1",
    { slug: "grex-id" },
  );

  let systemId: string;
  if (existingSystem[0] && existingSystem[0].length > 0) {
    systemId = existingSystem[0][0].id;
    console.log("[seed] system already exists: grex-id");
  } else {
    const result = await db.query<[{ id: string }[]]>(
      `CREATE system SET
        name = $name,
        slug = $slug,
        logoUri = ""`,
      { name: "GrexID", slug: "grex-id" },
    );
    systemId = result[0][0].id;
    console.log("[seed] system created: GrexID (grex-id)");
  }

  // 2. Create the STANDARD plan
  const existingPlan = await db.query<[{ id: string }[]]>(
    "SELECT id FROM plan WHERE name = $name AND systemId = $systemId LIMIT 1",
    { name: "plans.grexId.standard.name", systemId },
  );

  if (existingPlan[0] && existingPlan[0].length > 0) {
    console.log("[seed] plan already exists: STANDARD for grex-id");
  } else {
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
}
