import { NextRequest, NextResponse } from "next/server";
import { getDb, rid } from "@/server/db/connection";
import { clampPageLimit, sanitizeString } from "@/src/lib/validators";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const search = url.searchParams.get("search") ?? undefined;
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const direction = url.searchParams.get("direction") ?? "next";
  const limit = clampPageLimit(Number(url.searchParams.get("limit") ?? "20"));

  const db = await getDb();
  let query = "SELECT * FROM voucher";
  const bindings: Record<string, unknown> = { limit: limit + 1 };
  const conditions: string[] = [];

  if (search) {
    conditions.push("code CONTAINS $search");
    bindings.search = search;
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
    code,
    applicableCompanyIds,
    priceModifier,
    permissions,
    entityLimitModifiers,
    apiRateLimitModifier,
    storageLimitModifier,
    expiresAt,
  } = body;

  if (!code) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "VALIDATION",
          message: "validation.voucher.codeRequired",
        },
      },
      { status: 400 },
    );
  }

  const db = await getDb();
  const hasEntityLimitModifiers = entityLimitModifiers &&
    Object.keys(entityLimitModifiers).length > 0;
  const result = await db.query<[Record<string, unknown>[]]>(
    `CREATE voucher SET
      code = $code,
      applicableCompanyIds = $applicableCompanyIds,
      priceModifier = $priceModifier,
      permissions = $permissions,
      ${
      hasEntityLimitModifiers
        ? "entityLimitModifiers = $entityLimitModifiers,"
        : ""
    }
      apiRateLimitModifier = $apiRateLimitModifier,
      storageLimitModifier = $storageLimitModifier,
      expiresAt = $expiresAt`,
    {
      code: sanitizeString(code),
      applicableCompanyIds: applicableCompanyIds ?? [],
      priceModifier: Number(priceModifier ?? 0),
      permissions: permissions ?? [],
      entityLimitModifiers: hasEntityLimitModifiers
        ? entityLimitModifiers
        : undefined,
      apiRateLimitModifier: Number(apiRateLimitModifier ?? 0),
      storageLimitModifier: Number(storageLimitModifier ?? 0),
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
    },
  );

  return NextResponse.json({ success: true, data: result[0]?.[0] }, {
    status: 201,
  });
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const {
    id,
    code,
    applicableCompanyIds,
    priceModifier,
    permissions,
    entityLimitModifiers,
    apiRateLimitModifier,
    storageLimitModifier,
    expiresAt,
  } = body;

  if (!id) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "VALIDATION", errors: ["validation.id.required"] },
      },
      { status: 400 },
    );
  }

  try {
    const db = await getDb();
    const sets: string[] = [];
    const bindings: Record<string, unknown> = { id: rid(String(id)) };

    if (code !== undefined) {
      sets.push("code = $code");
      bindings.code = sanitizeString(code);
    }
    if (applicableCompanyIds !== undefined) {
      sets.push("applicableCompanyIds = $applicableCompanyIds");
      bindings.applicableCompanyIds = applicableCompanyIds;
    }
    if (priceModifier !== undefined) {
      sets.push("priceModifier = $priceModifier");
      bindings.priceModifier = Number(priceModifier);
    }
    if (permissions !== undefined) {
      sets.push("permissions = $permissions");
      bindings.permissions = permissions;
    }
    if (entityLimitModifiers !== undefined) {
      if (
        entityLimitModifiers && Object.keys(entityLimitModifiers).length > 0
      ) {
        sets.push("entityLimitModifiers = $entityLimitModifiers");
        bindings.entityLimitModifiers = entityLimitModifiers;
      } else {
        sets.push("entityLimitModifiers = NONE");
      }
    }
    if (apiRateLimitModifier !== undefined) {
      sets.push("apiRateLimitModifier = $apiRateLimitModifier");
      bindings.apiRateLimitModifier = Number(apiRateLimitModifier);
    }
    if (storageLimitModifier !== undefined) {
      sets.push("storageLimitModifier = $storageLimitModifier");
      bindings.storageLimitModifier = Number(storageLimitModifier);
    }
    if (expiresAt !== undefined) {
      sets.push("expiresAt = $expiresAt");
      bindings.expiresAt = expiresAt ? new Date(expiresAt) : null;
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
    console.error("Failed to update voucher:", err);
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
        error: { code: "VALIDATION", errors: ["validation.id.required"] },
      },
      { status: 400 },
    );
  }

  const db = await getDb();
  await db.query("DELETE $id", { id: rid(id) });
  return NextResponse.json({ success: true });
}
