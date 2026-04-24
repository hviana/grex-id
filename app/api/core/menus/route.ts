import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import { clampPageLimit, sanitizeString } from "@/src/lib/validators";
import { standardizeField } from "@/server/utils/field-standardizer";
import { validateField } from "@/server/utils/field-validator";
import Core from "@/server/utils/Core";
import {
  createMenuItem,
  deleteMenuItem,
  paginatedListMenuItems,
  updateMenuItem,
} from "@/server/db/queries/menus";

async function getHandler(req: Request, _ctx: RequestContext) {
  const url = new URL(req.url);
  const search = url.searchParams.get("search") ?? undefined;
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const direction = (url.searchParams.get("direction") as "next" | "prev") ??
    "next";
  const limit = clampPageLimit(Number(url.searchParams.get("limit") ?? "50"));
  const systemId = url.searchParams.get("systemId") ?? undefined;

  const result = await paginatedListMenuItems({
    search,
    systemId,
    cursor,
    limit,
    direction,
  });

  return Response.json({
    success: true,
    data: result.data,
    nextCursor: result.nextCursor,
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
  errors.push(...await validateField("name", label));
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
    const item = await createMenuItem({
      systemId,
      parentId,
      label: await standardizeField("name", sanitizeString(label)),
      emoji: emoji || undefined,
      componentName: sanitizeString(componentName ?? ""),
      sortOrder: Number(sortOrder ?? 0),
      requiredRoles: requiredRoles ?? [],
      hiddenInPlanIds: hiddenInPlanIds ?? [],
    });

    await Core.getInstance().reload();

    return Response.json(
      { success: true, data: item },
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
    const updates: Partial<{
      parentId: string | null;
      label: string;
      emoji: string;
      componentName: string;
      sortOrder: number;
      requiredRoles: string[];
      hiddenInPlanIds: string[];
    }> = {};

    if (data.parentId !== undefined) {
      updates.parentId = data.parentId;
    }
    if (data.label !== undefined) {
      updates.label = await standardizeField(
        "name",
        sanitizeString(data.label),
      );
    }
    if (data.emoji !== undefined) {
      updates.emoji = data.emoji;
    }
    if (data.componentName !== undefined) {
      updates.componentName = sanitizeString(data.componentName);
    }
    if (data.sortOrder !== undefined) {
      updates.sortOrder = Number(data.sortOrder);
    }
    if (data.requiredRoles !== undefined) {
      updates.requiredRoles = data.requiredRoles;
    }
    if (data.hiddenInPlanIds !== undefined) {
      updates.hiddenInPlanIds = data.hiddenInPlanIds;
    }

    if (Object.keys(updates).length === 0) {
      return Response.json({ success: true, data: null });
    }

    const updated = await updateMenuItem(id, updates);

    await Core.getInstance().reload();

    return Response.json({ success: true, data: updated });
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
    await deleteMenuItem(id);

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
  withAuth({ requireAuthenticated: true }),
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
