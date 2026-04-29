import { compose } from "@/server/middleware/compose";
import { withAuthAndLimit } from "@/server/middleware/withAuthAndLimit";
import type { RequestContext } from "@/src/contracts/high-level/tenant-context";
import { clampPageLimit } from "@/src/lib/validators";
import {
  genericCreate,
  genericDelete,
  genericList,
  genericUpdate,
} from "@/server/db/queries/generics";
import { rid } from "@/server/db/connection";
import Core from "@/server/utils/Core";
import type { Role } from "@/src/contracts/role";

async function getHandler(req: Request, ctx: RequestContext) {
  const url = new URL(req.url);
  const search = url.searchParams.get("search") ?? undefined;
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const limit = clampPageLimit(Number(url.searchParams.get("limit") ?? "20"));
  const tenantId = url.searchParams.get("tenantId") ?? undefined;
  const systemId = url.searchParams.get("systemId") ?? undefined;

  const roles = ctx.tenantContext.roles;
  const isSuperuser = roles.includes("superuser");

  const extraConditions: string[] = [];
  const extraBindings: Record<string, unknown> = {};

  if (!isSuperuser && ctx.tenantContext.tenant.systemId) {
    extraConditions.push(
      "tenantIds CONTAINS (SELECT id FROM tenant WHERE actorId = NONE AND companyId = NONE AND systemId = $autoSystemId LIMIT 1)",
    );
    extraBindings.autoSystemId = rid(ctx.tenantContext.tenant.systemId);
  }

  if (systemId) {
    extraConditions.push(
      "tenantIds CONTAINS (SELECT id FROM tenant WHERE actorId = NONE AND companyId = NONE AND systemId = $filterSystemId LIMIT 1)",
    );
    extraBindings.filterSystemId = rid(systemId);
  }

  if (tenantId) {
    extraConditions.push("tenantIds CONTAINS $tenantId");
    extraBindings.tenantId = tenantId;
  }

  const result = await genericList<Role>({
    table: "role",
    searchFields: ["name"],
    extraConditions: extraConditions.length > 0 ? extraConditions : undefined,
    extraBindings: Object.keys(extraBindings).length > 0
      ? extraBindings
      : undefined,
    cursor,
    limit,
    search,
  });

  return Response.json({ success: true, ...result });
}

async function postHandler(req: Request, _ctx: RequestContext) {
  const body = await req.json();
  const { name, tenantId, isBuiltIn } = body;

  if (!tenantId) {
    return Response.json(
      {
        success: false,
        error: { code: "VALIDATION", errors: ["validation.tenant.required"] },
      },
      { status: 400 },
    );
  }

  try {
    const result = await genericCreate<Role>(
      {
        table: "role",
        fields: [{ field: "name", unique: true }],
        tenant: {
          id: tenantId,
          systemId: "",
          companyId: "",
        },
      },
      {
        name,
        isBuiltIn: isBuiltIn ?? false,
      },
    );

    if (!result.success) {
      if (result.duplicateFields?.length) {
        return Response.json(
          {
            success: false,
            error: {
              code: "CONFLICT",
              errors: result.duplicateFields.map(
                (f) => `validation.${f}.duplicate`,
              ),
            },
          },
          { status: 409 },
        );
      }
      return Response.json(
        {
          success: false,
          error: {
            code: "VALIDATION",
            errors: result.errors?.flatMap((e) => e.errors) ?? [],
          },
        },
        { status: 400 },
      );
    }

    await Core.getInstance().reload();

    return Response.json(
      { success: true, data: result.data },
      { status: 201 },
    );
  } catch (e) {
    return Response.json(
      {
        success: false,
        error: { code: "ERROR", message: String(e) },
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
    const updates: Record<string, unknown> = {};

    if (data.name !== undefined) {
      updates.name = data.name;
    }
    if (data.isBuiltIn !== undefined) {
      updates.isBuiltIn = data.isBuiltIn;
    }

    if (Object.keys(updates).length === 0) {
      return Response.json({ success: true, data: null });
    }

    const result = await genericUpdate<Role>(
      { table: "role", fields: [{ field: "name", unique: true }] },
      id,
      updates,
    );

    if (!result.success) {
      if (result.duplicateFields?.length) {
        return Response.json(
          {
            success: false,
            error: {
              code: "CONFLICT",
              errors: result.duplicateFields.map(
                (f) => `validation.${f}.duplicate`,
              ),
            },
          },
          { status: 409 },
        );
      }
      const firstError = result.errors?.[0];
      if (firstError?.field === "id") {
        return Response.json(
          {
            success: false,
            error: { code: "ERROR", message: "common.error.generic" },
          },
          { status: 404 },
        );
      }
      return Response.json(
        {
          success: false,
          error: {
            code: "VALIDATION",
            errors: result.errors?.flatMap((e) => e.errors) ?? [],
          },
        },
        { status: 400 },
      );
    }

    await Core.getInstance().reload();

    return Response.json({ success: true, data: result.data });
  } catch (e) {
    console.error("[PUT /api/core/roles]", e);
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
    const result = await genericDelete({ table: "role" }, id);

    if (!result.deleted) {
      return Response.json(
        {
          success: false,
          error: { code: "ERROR", message: "common.error.generic" },
        },
        { status: 404 },
      );
    }

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
    requireAuthenticated: true,
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
