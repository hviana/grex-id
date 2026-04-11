import { NextRequest, NextResponse } from "next/server";
import { getDb, rid } from "@/server/db/connection";
import { clampPageLimit, sanitizeString } from "@/src/lib/validators";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const search = url.searchParams.get("search") ?? undefined;
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const direction = url.searchParams.get("direction") ?? "next";
  const limit = clampPageLimit(Number(url.searchParams.get("limit") ?? "20"));
  const systemId = url.searchParams.get("systemId") ?? undefined;

  const db = await getDb();
  let query = "SELECT * FROM role";
  const bindings: Record<string, unknown> = { limit: limit + 1 };
  const conditions: string[] = [];

  if (search) {
    conditions.push("name CONTAINS $search");
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

  query += " ORDER BY createdAt DESC LIMIT $limit";

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
  const { name, systemId, permissions, isBuiltIn } = body;

  if (!name || !systemId) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "VALIDATION",
          message: "validation.role.requiredFields",
        },
      },
      { status: 400 },
    );
  }

  try {
    const db = await getDb();
    const result = await db.query<[Record<string, unknown>[]]>(
      `CREATE role SET
        name = $name,
        systemId = $systemId,
        permissions = $permissions,
        isBuiltIn = $isBuiltIn`,
      {
        name: sanitizeString(name),
        systemId: rid(systemId),
        permissions: permissions ?? [],
        isBuiltIn: isBuiltIn ?? false,
      },
    );

    return NextResponse.json({ success: true, data: result[0]?.[0] }, {
      status: 201,
    });
  } catch (err) {
    console.error("Failed to create role:", err);
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

    if (data.name !== undefined) {
      sets.push("name = $name");
      bindings.name = sanitizeString(data.name);
    }
    if (data.permissions !== undefined) {
      sets.push("permissions = $permissions");
      bindings.permissions = data.permissions;
    }
    if (data.isBuiltIn !== undefined) {
      sets.push("isBuiltIn = $isBuiltIn");
      bindings.isBuiltIn = data.isBuiltIn;
    }

    const result = await db.query<[Record<string, unknown>[]]>(
      `UPDATE $id SET ${sets.join(", ")} RETURN AFTER`,
      bindings,
    );

    return NextResponse.json({ success: true, data: result[0]?.[0] });
  } catch (err) {
    console.error("Failed to update role:", err);
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
    console.error("Failed to delete role:", err);
    return NextResponse.json(
      {
        success: false,
        error: { code: "ERROR", message: "common.error.generic" },
      },
      { status: 500 },
    );
  }
}
