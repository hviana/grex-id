import type { Surreal } from "surrealdb";
import { assertServerOnly } from "../../../../utils/server-only.ts";

assertServerOnly("002_grex_id_menus");

export async function seed(db: Surreal): Promise<void> {
  // Resolve system-level tenant for grex-id
  const tenantResult = await db.query<[{ id: string }[]]>(
    `SELECT id FROM tenant WHERE !actorId AND !companyId AND systemId = (SELECT id FROM system WHERE slug = "grex-id" LIMIT 1)[0].id LIMIT 1`,
  );
  const systemTenantId = tenantResult[0]?.[0]?.id;
  if (!systemTenantId) {
    console.log("[seed] grex-id system tenant not found, skipping menu seed");
    return;
  }

  const existing = await db.query<[{ id: string }[]]>(
    `SELECT id FROM menu_item WHERE tenantIds CONTAINS $systemTenantId LIMIT 1`,
    { systemTenantId },
  );
  if ((existing[0] ?? []).length > 0) {
    console.log("[seed] grex-id menus already exist, skipping");
    return;
  }

  await db.query(
    `CREATE menu_item SET
       tenantIds = {$systemTenantId},
       label = "systems.grex-id.menu.locations",
       emoji = "📍",
       componentName = "grexid-locations",
       sortOrder = 0,
       requiredRoles = [],
       hiddenInPlanIds = [];
     CREATE menu_item SET
       tenantIds = {$systemTenantId},
       label = "systems.grex-id.menu.leads",
       emoji = "👤",
       componentName = "grexid-leads",
       sortOrder = 1,
       requiredRoles = [],
       hiddenInPlanIds = [];
     CREATE menu_item SET
       tenantIds = {$systemTenantId},
       label = "systems.grex-id.menu.detections",
       emoji = "🎯",
       componentName = "grexid-detections",
       sortOrder = 2,
       requiredRoles = [],
       hiddenInPlanIds = [];
     CREATE menu_item SET
       tenantIds = {$systemTenantId},
       label = "systems.grex-id.menu.settings",
       emoji = "⚙️",
       componentName = "grexid-settings",
       sortOrder = 3,
       requiredRoles = [],
       hiddenInPlanIds = [];`,
    { systemTenantId },
  );

  console.log("[seed] grex-id menus created: 4");
}
