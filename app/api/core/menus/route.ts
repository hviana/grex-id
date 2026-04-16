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
  const limit = clampPageLimit(Number(url.searchParams.get("limit") ?? "50"));
  const systemId = url.searchParams.get("systemId") ?? undefined;

  const db = await getDb();
  let query = "SELECT * FROM menu_item";
  const bindings: Record<string, unknown> = { limit: limit + 1 };
  const conditions: string[] = [];

  if (search) {
    conditions.push("label @@ $search");
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
    systemId,
    parentId,
    label,
    emoji,
    componentName,
    sortOrder,
    requiredRoles,
    hiddenInPlanIds,
  } = body;

  const errors: string[] = [];
  errors.push(...validateField("name", label));
  if (!systemId) errors.push("validation.system.required");

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
        label: standardizeField("name", sanitizeString(label)),
        emoji: emoji || undefined,
        componentName: sanitizeString(componentName ?? ""),
        sortOrder: Number(sortOrder ?? 0),
        requiredRoles: requiredRoles ?? [],
        hiddenInPlanIds: hiddenInPlanIds ?? [],
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

    if (data.parentId !== undefined) {
      sets.push("parentId = $parentId");
      bindings.parentId = data.parentId ? rid(data.parentId) : undefined;
    }
    if (data.label !== undefined) {
      sets.push("label = $label");
      bindings.label = standardizeField("name", sanitizeString(data.label));
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
