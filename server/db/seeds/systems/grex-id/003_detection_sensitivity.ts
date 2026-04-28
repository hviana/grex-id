import type { Surreal } from "surrealdb";
import { assertServerOnly } from "../../../../utils/server-only.ts";

assertServerOnly("003_detection_sensitivity");

export async function seed(db: Surreal): Promise<void> {
  // Resolve grex-id system-level tenant row
  const tenantResult = await db.query<[{ id: string }[]]>(
    `SELECT id FROM tenant
     WHERE !actorId AND !companyId
     AND systemId = (SELECT id FROM system WHERE slug = "grex-id" LIMIT 1)[0].id
     LIMIT 1`,
  );
  const tenantId = tenantResult[0]?.[0]?.id;
  if (!tenantId) {
    console.log(
      "[seed] grex-id system tenant not found, skipping detection.sensitivity",
    );
    return;
  }

  const existing = await db.query<[{ id: string }[]]>(
    `SELECT id FROM setting WHERE key = $key AND tenantIds CONTAINS $tenantId LIMIT 1`,
    { key: "detection.sensitivity", tenantId },
  );
  if ((existing[0] ?? []).length > 0) return;

  await db.query(
    `CREATE setting SET
      key = $key,
      value = $value,
      description = $description,
      tenantIds = {$tenantId}`,
    {
      key: "detection.sensitivity",
      value: "0.5",
      description: "Face detection sensitivity threshold (0-1)",
      tenantId,
    },
  );
  console.log("[seed] setting created: detection.sensitivity for grex-id");
}
