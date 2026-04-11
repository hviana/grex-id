import { getDb, rid, undefined } from "../connection.ts";
import type { MenuItem } from "@/src/contracts/menu";

export async function listMenuItems(systemId?: string): Promise<MenuItem[]> {
  const db = await getDb();

  let query = "SELECT * FROM menu_item";
  const bindings: Record<string, unknown> = {};

  if (systemId) {
    query += " WHERE systemId = $systemId";
    bindings.systemId = systemId;
  }

  query += " ORDER BY sortOrder ASC";

  const result = await db.query<[MenuItem[]]>(query, bindings);
  return result[0] ?? [];
}

export async function createMenuItem(data: {
  systemId: string;
  parentId?: string;
  label: string;
  emoji?: string;
  componentName: string;
  sortOrder?: number;
  requiredRoles?: string[];
  hiddenInPlanIds?: string[];
}): Promise<MenuItem> {
  const db = await getDb();
  const result = await db.query<[MenuItem[]]>(
    `CREATE menu_item SET
      systemId = $systemId,
      parentId = $parentId,
      label = $label,
      emoji = $emoji,
      componentName = $componentName,
      sortOrder = $sortOrder,
      requiredRoles = $requiredRoles,
      hiddenInPlanIds = $hiddenInPlanIds`,
    {
      ...data,
      systemId: rid(data.systemId),
      parentId: data.parentId ? rid(data.parentId) : undefined,
      emoji: data.emoji ?? undefined,
      sortOrder: data.sortOrder ?? 0,
      requiredRoles: data.requiredRoles ?? [],
      hiddenInPlanIds: data.hiddenInPlanIds ?? [],
    },
  );
  return result[0][0];
}

export async function updateMenuItem(
  id: string,
  data: Partial<{
    parentId: string | null;
    label: string;
    emoji: string;
    componentName: string;
    sortOrder: number;
    requiredRoles: string[];
    hiddenInPlanIds: string[];
  }>,
): Promise<MenuItem> {
  const db = await getDb();
  const sets: string[] = [];
  const bindings: Record<string, unknown> = { id: rid(id) };

  if (data.parentId !== undefined) {
    sets.push("parentId = $parentId");
    bindings.parentId = data.parentId ? rid(data.parentId) : undefined;
  }
  if (data.label !== undefined) {
    sets.push("label = $label");
    bindings.label = data.label;
  }
  if (data.emoji !== undefined) {
    sets.push("emoji = $emoji");
    bindings.emoji = data.emoji || undefined;
  }
  if (data.componentName !== undefined) {
    sets.push("componentName = $componentName");
    bindings.componentName = data.componentName;
  }
  if (data.sortOrder !== undefined) {
    sets.push("sortOrder = $sortOrder");
    bindings.sortOrder = data.sortOrder;
  }
  if (data.requiredRoles !== undefined) {
    sets.push("requiredRoles = $requiredRoles");
    bindings.requiredRoles = data.requiredRoles;
  }
  if (data.hiddenInPlanIds !== undefined) {
    sets.push("hiddenInPlanIds = $hiddenInPlanIds");
    bindings.hiddenInPlanIds = data.hiddenInPlanIds;
  }

  const result = await db.query<[MenuItem[]]>(
    `UPDATE $id SET ${sets.join(", ")} RETURN AFTER`,
    bindings,
  );
  return result[0][0];
}

export async function deleteMenuItem(id: string): Promise<void> {
  const db = await getDb();
  await db.query("DELETE $id", { id: rid(id) });
}
