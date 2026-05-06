import { compose } from "@/server/middleware/compose";
import { withAuthAndLimit } from "@/server/middleware/withAuthAndLimit";

import type { RequestContext } from "@/src/contracts/high-level/tenant-context";
import type { Group } from "@/src/contracts/group";
import {
  genericCreate,
  genericDelete,
  genericGetById,
  genericList,
  genericUpdate,
} from "@/server/db/queries/generics";
import { parseBody } from "@/server/utils/parse-body";
import { csTenant } from "@/server/utils/cs-tenant";

async function getHandler(req: Request, ctx: RequestContext) {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  if (action === "get-one") {
    const id = url.searchParams.get("id") ?? "";
    const group = await genericGetById<Group>(
      {
        table: "group",
        select: "id, name, description, tenantIds, createdAt, updatedAt",
        tenant: csTenant(ctx),
      },
      id,
    );
    return Response.json({ success: true, data: group });
  }

  const search = url.searchParams.get("search") ?? undefined;
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const limit = Number(url.searchParams.get("limit") ?? "20");

  if (
    !ctx.tenantContext.tenant.companyId || !ctx.tenantContext.tenant.systemId
  ) {
    return Response.json({
      success: true,
      items: [],
      total: 0,
      hasMore: false,
    });
  }

  const result = await genericList<Group>({
    table: "group",
    select: "id, name, description, tenantIds, createdAt, updatedAt",
    searchFields: ["name"],
    limit,
    cursor,
    search,
    tenant: csTenant(ctx),
  });

  return Response.json({ success: true, ...result });
}

async function postHandler(req: Request, ctx: RequestContext) {
  const { body, error } = await parseBody(req);
  if (error) return error;
  const { name, description } = body;

  if (!name) {
    return Response.json(
      {
        success: false,
        error: { code: "VALIDATION", errors: ["validation.fields.required"] },
      },
      { status: 400 },
    );
  }

  if (
    !ctx.tenantContext.tenant.companyId || !ctx.tenantContext.tenant.systemId
  ) {
    return Response.json(
      {
        success: false,
        error: {
          code: "VALIDATION",
          message: "validation.companyAndSystem.required",
        },
      },
      { status: 400 },
    );
  }

  const result = await genericCreate<Group>(
    {
      table: "group",
      tenant: csTenant(ctx),
      allowCreateCallerTenant: true,
      fields: [{ field: "name" }, { field: "description" }],
    },
    { name, description: description || undefined },
  );

  if (!result.success) {
    return Response.json(
      { success: false, error: { code: "VALIDATION", errors: result.errors } },
      { status: 400 },
    );
  }

  return Response.json(
    { success: true, data: result.data },
    { status: 201 },
  );
}

async function putHandler(req: Request, ctx: RequestContext) {
  const { body, error } = await parseBody(req);
  if (error) return error;
  const { id, name, description } = body;

  if (!id) {
    return Response.json(
      {
        success: false,
        error: { code: "VALIDATION", errors: ["validation.id.required"] },
      },
      { status: 400 },
    );
  }

  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = name;
  if (description !== undefined) data.description = description || undefined;

  const result = await genericUpdate<Group>(
    {
      table: "group",
      tenant: csTenant(ctx),
      fields: [{ field: "name" }, { field: "description" }],
    },
    id,
    data,
  );

  if (!result.success) {
    return Response.json(
      { success: false, error: { code: "VALIDATION", errors: result.errors } },
      { status: 400 },
    );
  }

  return Response.json({ success: true, data: result.data });
}

async function deleteHandler(req: Request, ctx: RequestContext) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";

  if (!id) {
    return Response.json(
      {
        success: false,
        error: { code: "VALIDATION", errors: ["validation.id.required"] },
      },
      { status: 400 },
    );
  }

  await genericDelete(
    { table: "group", tenant: csTenant(ctx) },
    id,
  );
  return Response.json({ success: true });
}

export const GET = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 60 },
    accesses: [{ roles: ["admin"] }],
  }),
  async (req, ctx) => getHandler(req, ctx),
);

export const POST = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 60 },
    accesses: [{ roles: ["admin"] }],
  }),
  async (req, ctx) => postHandler(req, ctx),
);

export const PUT = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 60 },
    accesses: [{ roles: ["admin"] }],
  }),
  async (req, ctx) => putHandler(req, ctx),
);

export const DELETE = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 60 },
    accesses: [{ roles: ["admin"] }],
  }),
  async (req, ctx) => deleteHandler(req, ctx),
);
