import { compose } from "@/server/middleware/compose";
import { withAuthAndLimit } from "@/server/middleware/withAuthAndLimit";

import type { RequestContext } from "@/src/contracts/high-level/tenant-context";
import { clampPageLimit, sanitizeString } from "@/src/lib/validators";
import { standardizeField } from "@/server/utils/field-standardizer";
import { validateField } from "@/server/utils/field-validator";
import { updateTenantCache } from "@/server/utils/cache";
import {
  genericCreate,
  genericDelete,
  genericList,
  genericUpdate,
} from "@/server/db/queries/generics";
import { parseBody } from "@/server/utils/parse-body";
import { resolveTenantForScope } from "@/server/db/queries/core-settings";
import { rid } from "@/server/db/connection";
import type { MenuItem } from "@/src/contracts/menu-item";

async function getHandler(req: Request, _ctx: RequestContext) {
  const url = new URL(req.url);
  const search = url.searchParams.get("search") ?? undefined;
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const limit = clampPageLimit(Number(url.searchParams.get("limit") ?? "50"));
  const systemId = url.searchParams.get("systemId") ?? undefined;
  // Keep legacy tenantId support for backward compatibility
  const tenantIdParam = url.searchParams.get("tenantId") ?? undefined;

  const extraConditions: string[] = [];
  const extraBindings: Record<string, unknown> = {};

  // Resolve systemId to the system-level tenant (actorId=NONE, companyId=NONE)
  if (systemId) {
    const resolvedTenantId = await resolveTenantForScope(systemId);
    if (resolvedTenantId) {
      extraConditions.push("tenantIds CONTAINS $tenantId");
      extraBindings.tenantId = rid(resolvedTenantId);
    }
  } else if (tenantIdParam) {
    extraConditions.push("tenantIds CONTAINS $tenantId");
    extraBindings.tenantId = rid(tenantIdParam);
  }

  const result = await genericList<MenuItem>({
    table: "menu_item",
    searchFields: ["name"],
    orderBy: "sortOrder",
    extraConditions,
    extraBindings,
    extraAccessFields: ["tenantIds"],
    allowRawExtraConditions: true,
    skipAccessCheck: true,
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
    planIds,
  } = body;

  let resolvedTenantId = tenantId;

  // Resolve tenantId from systemId when the frontend sends systemId instead
  if (!resolvedTenantId && systemId) {
    resolvedTenantId = await resolveTenantForScope(systemId) ?? undefined;
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
        fields: [
          { field: "parentId" },
          { field: "name" },
          { field: "emoji" },
          { field: "componentName" },
          { field: "sortOrder" },
          { field: "roleIds" },
          { field: "planIds" },
        ],
      },
      {
        parentId: parentId || undefined,
        name: await standardizeField("name", sanitizeString(name)),
        emoji: emoji || undefined,
        componentName: sanitizeString(componentName ?? ""),
        sortOrder: Number(sortOrder ?? 0),
        roleIds: roleIds?.length ? roleIds : undefined,
        planIds: planIds?.length ? planIds : undefined,
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

    updateTenantCache();

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
    if (data.planIds !== undefined) {
      updates.planIds = data.planIds;
    }

    if (Object.keys(updates).length === 0) {
      return Response.json({ success: true, data: null });
    }

    const result = await genericUpdate<MenuItem>(
      {
        table: "menu_item",
        fields: [
          { field: "parentId" },
          { field: "name" },
          { field: "emoji" },
          { field: "componentName" },
          { field: "sortOrder" },
          { field: "roleIds" },
          { field: "planIds" },
        ],
        skipAccessCheck: true,
      },
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

    updateTenantCache();

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
    await genericDelete({ table: "menu_item", skipAccessCheck: true }, id);

    updateTenantCache();

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
    accesses: [{ roles: ["superuser"] }],
  }),
  postHandler,
);

export const PUT = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 100 },
    accesses: [{ roles: ["superuser"] }],
  }),
  putHandler,
);

export const DELETE = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 100 },
    accesses: [{ roles: ["superuser"] }],
  }),
  deleteHandler,
);
