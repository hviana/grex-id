import { NextRequest, NextResponse } from "next/server";
import { getDb, rid } from "@/server/db/connection";
import { clampPageLimit, sanitizeString } from "@/src/lib/validators";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const search = url.searchParams.get("search") ?? undefined;
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const direction = url.searchParams.get("direction") ?? "next";
  const limit = clampPageLimit(Number(url.searchParams.get("limit") ?? "50"));
  const systemId = url.searchParams.get("systemId") ?? undefined;

  const db = await getDb();
  let query = "SELECT * FROM menu_item";
  const bindings: Record<string, unknown> = { limit: limit + 1 };
  const conditions: string[] = [];

  if (search) {
    conditions.push("label CONTAINS $search");
    bindings.search = search;
  }

  if (systemId) {
    conditions.push("systemId = $systemId");
    bindings.systemId = rid(systemId);
  }

  if (cursor) {
    conditions.push(direction === "prev" ? "id < $cursor" : "id > $cursor");
    bindings.cursor = cursor;
  }

  if (conditions.length > 0) {
    query += " WHERE " + conditions.join(" AND ");
  }

  query += " ORDER BY sortOrder ASC, createdAt DESC LIMIT $limit";

  const result = await db.query<[Record<string, unknown>[]]>(query, bindings);
  const items = result[0] ?? [];
  const hasMore = items.length > limit;
  const data = hasMore ? items.slice(0, limit) : items;

  return NextResponse.json({
    success: true,
    data,
    nextCursor: hasMore && data.length > 0
      ? data[data.length - 1]?.id ?? null
      : null,
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    systemId,
    parentId,
    label,
    emoji,
    componentName,
    sortOrder,
    requiredRoles,
    hiddenInPlanIds,
  } = body;

  if (!systemId || !label) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "VALIDATION",
          message: "validation.menu.systemAndLabel",
        },
      },
      { status: 400 },
    );
  }

  try {
    const db = await getDb();
    const result = await db.query<[Record<string, unknown>[]]>(
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
        systemId: rid(systemId),
        parentId: parentId ? rid(parentId) : undefined,
        label: sanitizeString(label),
        emoji: emoji || undefined,
        componentName: sanitizeString(componentName ?? ""),
        sortOrder: Number(sortOrder ?? 0),
        requiredRoles: requiredRoles ?? [],
        hiddenInPlanIds: hiddenInPlanIds ?? [],
      },
    );

    return NextResponse.json({ success: true, data: result[0]?.[0] }, {
      status: 201,
    });
  } catch (err) {
    console.error("Failed to create menu item:", err);
    return NextResponse.json(
      {
        success: false,
        error: { code: "ERROR", message: "common.error.generic" },
      },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const { id, ...data } = body;

  if (!id) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "VALIDATION", message: "validation.id.required" },
      },
      { status: 400 },
    );
  }

  try {
    const db = await getDb();
    const sets: string[] = [];
    const bindings: Record<string, unknown> = { id: rid(id) };

    if (data.parentId !== undefined) {
      sets.push("parentId = $parentId");
      bindings.parentId = data.parentId ? rid(data.parentId) : undefined;
    }
    if (data.label !== undefined) {
      sets.push("label = $label");
      bindings.label = sanitizeString(data.label);
    }
    if (data.emoji !== undefined) {
      sets.push("emoji = $emoji");
      bindings.emoji = data.emoji || undefined;
    }
    if (data.componentName !== undefined) {
      sets.push("componentName = $componentName");
      bindings.componentName = sanitizeString(data.componentName);
    }
    if (data.sortOrder !== undefined) {
      sets.push("sortOrder = $sortOrder");
      bindings.sortOrder = Number(data.sortOrder);
    }
    if (data.requiredRoles !== undefined) {
      sets.push("requiredRoles = $requiredRoles");
      bindings.requiredRoles = data.requiredRoles;
    }
    if (data.hiddenInPlanIds !== undefined) {
      sets.push("hiddenInPlanIds = $hiddenInPlanIds");
      bindings.hiddenInPlanIds = data.hiddenInPlanIds;
    }

    if (sets.length === 0) {
      return NextResponse.json({ success: true, data: null });
    }

    const result = await db.query<[Record<string, unknown>[]]>(
      `UPDATE $id SET ${sets.join(", ")} RETURN AFTER`,
      bindings,
    );

    return NextResponse.json({ success: true, data: result[0]?.[0] });
  } catch (err) {
    console.error("Failed to update menu item:", err);
    return NextResponse.json(
      {
        success: false,
        error: { code: "ERROR", message: "common.error.generic" },
      },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  const body = await req.json();
  const { id } = body;

  if (!id) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "VALIDATION", message: "validation.id.required" },
      },
      { status: 400 },
    );
  }

  try {
    const db = await getDb();
    await db.query("DELETE $id", { id: rid(id) });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Failed to delete menu item:", err);
    return NextResponse.json(
      {
        success: false,
        error: { code: "ERROR", message: "common.error.generic" },
      },
      { status: 500 },
    );
  }
}
