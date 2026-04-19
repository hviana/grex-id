import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import { getDb, rid } from "@/server/db/connection";
import { clampPageLimit, sanitizeString } from "@/src/lib/validators";
import { standardizeField } from "@/server/utils/field-standardizer";
import { validateField } from "@/server/utils/field-validator";
import Core from "@/server/utils/Core";

async function getHandler(req: Request, _ctx: RequestContext) {
  const url = new URL(req.url);
  const search = url.searchParams.get("search") ?? undefined;
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const direction = (url.searchParams.get("direction") as "next" | "prev") ??
    "next";
  const limit = clampPageLimit(Number(url.searchParams.get("limit") ?? "20"));
  const systemId = url.searchParams.get("systemId") ?? undefined;

  const db = await getDb();
  let query = "SELECT * FROM plan";
  const bindings: Record<string, unknown> = { limit: limit + 1 };
  const conditions: string[] = [];

  if (search) {
    conditions.push("name @@ $search");
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

  return Response.json({
    success: true,
    data,
    nextCursor: hasMore && data.length > 0
      ? data[data.length - 1]?.id ?? null
      : null,
  });
}

async function postHandler(req: Request, _ctx: RequestContext) {
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
    fileCacheLimitBytes,
    isActive,
  } = body;

  const errors: string[] = [];
  errors.push(...validateField("name", name));
  if (!systemId) errors.push("validation.system.required");
  if (price === undefined) errors.push("validation.plan.priceRequired");
  if (!recurrenceDays) errors.push("validation.plan.recurrenceRequired");

  if (errors.length > 0) {
    return Response.json(
      {
        success: false,
        error: { code: "VALIDATION", errors },
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
        fileCacheLimitBytes = $fileCacheLimitBytes,
        isActive = $isActive`,
      {
        name: standardizeField("name", sanitizeString(name)),
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
        fileCacheLimitBytes: fileCacheLimitBytes ?? 20971520,
        isActive: isActive ?? true,
      },
    );

    await Core.getInstance().reload();

    return Response.json(
      { success: true, data: result[0]?.[0] },
      { status: 201 },
    );
  } catch {
    return Response.json(
      {
        success: false,
        error: { code: "ERROR", message: "common.error.generic" },
      },
      { status: 500 },
    );
  }
}

async function putHandler(req: Request, _ctx: RequestContext) {
  const body = await req.json();
  const { id, ...data } = body;

  if (!id) {
    return Response.json(
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
      "fileCacheLimitBytes",
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
            ? standardizeField(field, sanitizeString(value))
            : value;
        }
      }
    }
    sets.push("updatedAt = time::now()");

    if (sets.length === 1) {
      // Only updatedAt was added, no actual field changes
      return Response.json({ success: true, data: null });
    }

    const result = await db.query<[Record<string, unknown>[]]>(
      `UPDATE $id SET ${sets.join(", ")} RETURN AFTER`,
      bindings,
    );

    await Core.getInstance().reload();

    return Response.json({ success: true, data: result[0]?.[0] });
  } catch {
    return Response.json(
      {
        success: false,
        error: { code: "ERROR", message: "common.error.generic" },
      },
      { status: 500 },
    );
  }
}

async function deleteHandler(req: Request, _ctx: RequestContext) {
  const body = await req.json();
  const { id } = body;

  if (!id) {
    return Response.json(
      {
        success: false,
        error: { code: "VALIDATION", errors: ["validation.id.required"] },
      },
      { status: 400 },
    );
  }

  try {
    const db = await getDb();
    await db.query("DELETE $id", { id: rid(id) });

    await Core.getInstance().reload();

    return Response.json({ success: true });
  } catch {
    return Response.json(
      {
        success: false,
        error: { code: "ERROR", message: "common.error.generic" },
      },
      { status: 500 },
    );
  }
}

export const GET = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 100 }),
  withAuth({ requireAuthenticated: true, roles: ["superuser"] }),
  getHandler,
);

export const POST = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 100 }),
  withAuth({ requireAuthenticated: true, roles: ["superuser"] }),
  postHandler,
);

export const PUT = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 100 }),
  withAuth({ requireAuthenticated: true, roles: ["superuser"] }),
  putHandler,
);

export const DELETE = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 100 }),
  withAuth({ requireAuthenticated: true, roles: ["superuser"] }),
  deleteHandler,
);
