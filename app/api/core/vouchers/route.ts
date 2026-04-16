import { NextRequest, NextResponse } from "next/server";
import { getDb, rid } from "@/server/db/connection";
import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { clampPageLimit, sanitizeString } from "@/src/lib/validators";
import type { RequestContext } from "@/src/contracts/auth";

async function getHandler(req: NextRequest, _ctx: RequestContext) {
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

async function postHandler(req: NextRequest, _ctx: RequestContext) {
  const body = await req.json();
  const {
    code,
    applicableCompanyIds,
    applicablePlanIds,
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
      applicablePlanIds = $applicablePlanIds,
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
      applicablePlanIds: applicablePlanIds ?? [],
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

  return NextResponse.json(
    { success: true, data: result[0]?.[0] },
    { status: 201 },
  );
}

/**
 * PUT — updates a voucher with auto-removal cascade:
 * If applicablePlanIds is non-empty after the update, clears voucherId
 * on any subscription whose planId is NOT in the new list.
 * This runs in the same batched query as the voucher update (§22.7).
 */
async function putHandler(req: NextRequest, _ctx: RequestContext) {
  const body = await req.json();
  const {
    id,
    code,
    applicableCompanyIds,
    applicablePlanIds,
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
  if (applicablePlanIds !== undefined) {
    sets.push("applicablePlanIds = $applicablePlanIds");
    bindings.applicablePlanIds = applicablePlanIds ?? [];
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

  // Auto-removal cascade: if applicablePlanIds was updated and is non-empty,
  // strip voucherId from subscriptions whose planId is no longer in the list
  const shouldCascade = applicablePlanIds !== undefined &&
    Array.isArray(applicablePlanIds) &&
    applicablePlanIds.length > 0;

  const cascadeQuery = shouldCascade
    ? `UPDATE subscription SET voucherId = NONE
       WHERE voucherId = $id
         AND planId NOT IN $applicablePlanIds;`
    : "";

  const result = await db.query<[Record<string, unknown>[]]>(
    `UPDATE $id SET ${sets.join(", ")} RETURN AFTER;${cascadeQuery}`,
    bindings,
  );

  return NextResponse.json({ success: true, data: result[0]?.[0] });
}

async function deleteHandler(req: NextRequest, _ctx: RequestContext) {
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

  // Remove voucher reference from subscriptions + delete voucher in one batch
  await db.query(
    `UPDATE subscription SET voucherId = NONE WHERE voucherId = $id;
     DELETE $id;`,
    { id: rid(id) },
  );

  return NextResponse.json({ success: true });
}

export const GET = compose(
  withAuth({ requireAuthenticated: true, roles: ["superuser"] }),
  async (req, _ctx) => getHandler(req as NextRequest, _ctx),
);

export const POST = compose(
  withAuth({ requireAuthenticated: true, roles: ["superuser"] }),
  async (req, _ctx) => postHandler(req as NextRequest, _ctx),
);

export const PUT = compose(
  withAuth({ requireAuthenticated: true, roles: ["superuser"] }),
  async (req, _ctx) => putHandler(req as NextRequest, _ctx),
);

export const DELETE = compose(
  withAuth({ requireAuthenticated: true, roles: ["superuser"] }),
  async (req, _ctx) => deleteHandler(req as NextRequest, _ctx),
);
