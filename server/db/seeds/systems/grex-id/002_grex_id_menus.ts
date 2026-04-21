import type { Surreal } from "surrealdb";

export async function seed(db: Surreal): Promise<void> {
  const sysResult = await db.query<[{ id: string }[]]>(
    `SELECT id FROM system WHERE slug = "grex-id" LIMIT 1`,
  );
  const system = sysResult[0]?.[0];
  if (!system) {
    console.log("[seed] grex-id system not found, skipping menu seed");
    return;
  }

  const existing = await db.query<[{ id: string }[]]>(
    `SELECT id FROM menu_item WHERE systemId = $systemId LIMIT 1`,
    { systemId: system.id },
  );
  if ((existing[0] ?? []).length > 0) {
    console.log("[seed] grex-id menus already exist, skipping");
    return;
  }

  await db.query(
    `CREATE menu_item SET
       systemId = $systemId,
       label = "systems.grex-id.menu.locations",
       emoji = "📍",
       componentName = "grexid-locations",
       sortOrder = 0,
       requiredRoles = [],
       hiddenInPlanIds = [];
     CREATE menu_item SET
       systemId = $systemId,
       label = "systems.grex-id.menu.leads",
       emoji = "👤",
       componentName = "grexid-leads",
       sortOrder = 1,
       requiredRoles = [],
       hiddenInPlanIds = [];
     CREATE menu_item SET
       systemId = $systemId,
       label = "systems.grex-id.menu.detections",
       emoji = "🎯",
       componentName = "grexid-detections",
       sortOrder = 2,
       requiredRoles = [],
       hiddenInPlanIds = [];
     CREATE menu_item SET
       systemId = $systemId,
       label = "systems.grex-id.menu.settings",
       emoji = "⚙️",
       componentName = "grexid-settings",
       sortOrder = 3,
       requiredRoles = [],
       hiddenInPlanIds = [];`,
    { systemId: system.id },
  );

  console.log("[seed] grex-id menus created: 4");
}
