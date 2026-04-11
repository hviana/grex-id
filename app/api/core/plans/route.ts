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
  let query = "SELECT * FROM plan";
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
  const {
    name,
    description,
    systemId,
    price,
    currency,
    recurrenceDays,
    benefits,
    permissions,
    entityLimits,
    apiRateLimit,
    storageLimitBytes,
    isActive,
  } = body;

  if (!name || !systemId || price === undefined || !recurrenceDays) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "VALIDATION",
          message: "validation.plan.requiredFields",
        },
      },
      { status: 400 },
    );
  }

  try {
    const db = await getDb();
    const hasEntityLimits = entityLimits &&
      Object.keys(entityLimits).length > 0;
    const result = await db.query<[Record<string, unknown>[]]>(
      `CREATE plan SET
        name = $name,
        description = $description,
        systemId = $systemId,
        price = $price,
        currency = $currency,
        recurrenceDays = $recurrenceDays,
        benefits = $benefits,
        permissions = $permissions,
        ${hasEntityLimits ? "entityLimits = $entityLimits," : ""}
        apiRateLimit = $apiRateLimit,
        storageLimitBytes = $storageLimitBytes,
        isActive = $isActive`,
      {
        name: sanitizeString(name),
        description: sanitizeString(description ?? ""),
        systemId: rid(systemId),
        price: Number(price),
        currency: currency ?? "USD",
        recurrenceDays: Number(recurrenceDays),
        benefits: benefits ?? [],
        permissions: permissions ?? [],
        entityLimits: hasEntityLimits ? entityLimits : undefined,
        apiRateLimit: apiRateLimit ?? 1000,
        storageLimitBytes: storageLimitBytes ?? 1073741824,
        isActive: isActive ?? true,
      },
    );

    return NextResponse.json({ success: true, data: result[0]?.[0] }, {
      status: 201,
    });
  } catch (err) {
    console.error("Failed to create plan:", err);
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

    const fields = [
      "name",
      "description",
      "price",
      "currency",
      "recurrenceDays",
      "benefits",
      "permissions",
      "entityLimits",
      "apiRateLimit",
      "storageLimitBytes",
      "isActive",
    ] as const;

    for (const field of fields) {
      if (data[field] !== undefined) {
        const value = data[field];
        if (
          field === "entityLimits" &&
          (!value ||
            (typeof value === "object" &&
              Object.keys(value as object).length === 0))
        ) {
          sets.push(`${field} = NONE`);
        } else {
          sets.push(`${field} = $${field}`);
          bindings[field] = field === "name" || field === "description"
            ? sanitizeString(value)
            : value;
        }
      }
    }
    sets.push("updatedAt = time::now()");

    const result = await db.query<[Record<string, unknown>[]]>(
      `UPDATE $id SET ${sets.join(", ")} RETURN AFTER`,
      bindings,
    );

    return NextResponse.json({ success: true, data: result[0]?.[0] });
  } catch (err) {
    console.error("Failed to update plan:", err);
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
    console.error("Failed to delete plan:", err);
    return NextResponse.json(
      {
        success: false,
        error: { code: "ERROR", message: "common.error.generic" },
      },
      { status: 500 },
    );
  }
}
