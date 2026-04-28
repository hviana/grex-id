import { compose } from "@/server/middleware/compose";
import { withAuthAndLimit } from "@/server/middleware/withAuthAndLimit";

import type { RequestContext } from "@/src/contracts/high_level/tenant-context";
import {
  genericCreate,
  genericDelete,
  genericGetById,
  genericList,
  genericUpdate,
} from "@/server/db/queries/generics";

interface Group {
  id: string;
  name: string;
  description?: string;
  tenantIds: string[];
  createdAt: string;
  updatedAt: string;
}

async function getHandler(req: Request, ctx: RequestContext) {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  if (action === "get-one") {
    const id = url.searchParams.get("id") ?? "";
    const group = await genericGetById<Group>(
      { table: "group", tenant: ctx.tenantContext.tenant },
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
    searchFields: ["name"],
    limit,
    cursor,
    search,
    tenant: ctx.tenantContext.tenant,
  });

  return Response.json({ success: true, ...result });
}

async function postHandler(req: Request, ctx: RequestContext) {
  const body = await req.json();
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
      tenant: ctx.tenantContext.tenant,
    },
    { name, description: description || undefined },
  );

  return Response.json(
    { success: true, data: result.data },
    { status: 201 },
  );
}

async function putHandler(req: Request, ctx: RequestContext) {
  const body = await req.json();
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
    { table: "group", tenant: ctx.tenantContext.tenant },
    id,
    data,
  );

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
    { table: "group", tenant: ctx.tenantContext.tenant },
    id,
  );
  return Response.json({ success: true });
}

export const GET = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 60 },
    roles: ["admin"],
  }),
  async (req, ctx) => getHandler(req, ctx),
);

export const POST = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 60 },
    roles: ["admin"],
  }),
  async (req, ctx) => postHandler(req, ctx),
);

export const PUT = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 60 },
    roles: ["admin"],
  }),
  async (req, ctx) => putHandler(req, ctx),
);

export const DELETE = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 60 },
    roles: ["admin"],
  }),
  async (req, ctx) => deleteHandler(req, ctx),
);
