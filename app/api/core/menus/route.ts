import { compose } from "@/server/middleware/compose";
import { withAuthAndLimit } from "@/server/middleware/withAuthAndLimit";

import type { RequestContext } from "@/src/contracts/high-level/tenant-context";
import { clampPageLimit, sanitizeString } from "@/src/lib/validators";
import { standardizeField } from "@/server/utils/field-standardizer";
import { validateField } from "@/server/utils/field-validator";
import Core from "@/server/utils/Core";
import {
  genericCreate,
  genericDelete,
  genericList,
  genericUpdate,
} from "@/server/db/queries/generics";
import { parseBody } from "@/server/utils/parse-body";
import { rid } from "@/server/db/connection";
import type { MenuItem } from "@/src/contracts/menu-item";

async function getHandler(req: Request, _ctx: RequestContext) {
  const url = new URL(req.url);
  const search = url.searchParams.get("search") ?? undefined;
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const limit = clampPageLimit(Number(url.searchParams.get("limit") ?? "50"));
  const tenantId = url.searchParams.get("tenantId") ?? undefined;

  const extraConditions: string[] = [];
  const extraBindings: Record<string, unknown> = {};
  if (tenantId) {
    extraConditions.push("tenantIds CONTAINS $tenantId");
    extraBindings.tenantId = tenantId;
  }

  const result = await genericList<MenuItem>({
    table: "menu_item",
    searchFields: ["name"],
    orderBy: "sortOrder ASC, createdAt DESC",
    extraConditions,
    extraBindings,
    search,
    cursor,
    limit,
  });

  return Response.json({ success: true, ...result });
}

async function postHandler(req: Request, _ctx: RequestContext) {
  const { body, error } = await parseBody(req);
  if (error) return error;
  const {
    tenantId,
    systemId,
    parentId,
    name,
    emoji,
    componentName,
    sortOrder,
    roleIds,
    hiddenInPlanIds,
  } = body;

  let resolvedTenantId = tenantId;

  // Resolve tenantId from systemId when the frontend sends systemId instead
  if (!resolvedTenantId && systemId) {
    const { getDb } = await import("@/server/db/connection");
    const db = await getDb();
    const rows = await db.query<
      [{ id: string; actorId?: unknown; companyId?: unknown }[]]
    >(
      `SELECT id, actorId, companyId FROM tenant WHERE systemId = $systemId LIMIT 10`,
      { systemId: rid(systemId) },
    );
    const systemTenant = (rows[0] ?? []).find(
      (r) => !r.actorId && !r.companyId,
    );
    resolvedTenantId = systemTenant?.id;
  }

  const errors: string[] = [];
  errors.push(...await validateField("name", name));
  if (!resolvedTenantId) errors.push("validation.tenant.required");

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
    const result = await genericCreate<MenuItem>(
      {
        table: "menu_item",
        tenant: {
          id: resolvedTenantId,
        },
      },
      {
        parentId: parentId || undefined,
        name: await standardizeField("name", sanitizeString(name)),
        emoji: emoji || undefined,
        componentName: sanitizeString(componentName ?? ""),
        sortOrder: Number(sortOrder ?? 0),
        roleIds: roleIds ?? [],
        hiddenInPlanIds: hiddenInPlanIds ?? [],
      },
    );

    if (!result.success || !result.data) {
      return Response.json(
        {
          success: false,
          error: { code: "ERROR", message: "common.error.generic" },
        },
        { status: 500 },
      );
    }

    await Core.getInstance().reload();

    return Response.json(
      { success: true, data: result.data },
      { status: 201 },
    );
  } catch (e) {
    console.error("[POST /api/core/menus]", e);
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
  const { body, error } = await parseBody(req);
  if (error) return error;
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
    const updates: Record<string, unknown> = {};

    if (data.parentId !== undefined) {
      updates.parentId = data.parentId || undefined;
    }
    if (data.name !== undefined) {
      updates.name = await standardizeField(
        "name",
        sanitizeString(data.name),
      );
    }
    if (data.emoji !== undefined) {
      updates.emoji = data.emoji || undefined;
    }
    if (data.componentName !== undefined) {
      updates.componentName = sanitizeString(data.componentName);
    }
    if (data.sortOrder !== undefined) {
      updates.sortOrder = Number(data.sortOrder);
    }
    if (data.roleIds !== undefined) {
      updates.roleIds = data.roleIds;
    }
    if (data.hiddenInPlanIds !== undefined) {
      updates.hiddenInPlanIds = data.hiddenInPlanIds;
    }

    if (Object.keys(updates).length === 0) {
      return Response.json({ success: true, data: null });
    }

    const result = await genericUpdate<MenuItem>(
      { table: "menu_item" },
      id,
      updates,
    );

    if (!result.success || !result.data) {
      return Response.json(
        {
          success: false,
          error: { code: "ERROR", message: "common.error.generic" },
        },
        { status: 500 },
      );
    }

    await Core.getInstance().reload();

    return Response.json({ success: true, data: result.data });
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
  const { body, error } = await parseBody(req);
  if (error) return error;
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
    await genericDelete({ table: "menu_item" }, id);

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
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 100 },
  }),
  getHandler,
);

export const POST = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 100 },
    roles: ["superuser"],
  }),
  postHandler,
);

export const PUT = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 100 },
    roles: ["superuser"],
  }),
  putHandler,
);

export const DELETE = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 100 },
    roles: ["superuser"],
  }),
  deleteHandler,
);
