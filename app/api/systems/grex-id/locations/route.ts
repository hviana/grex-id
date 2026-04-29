import { compose } from "@/server/middleware/compose";
import { withAuthAndLimit } from "@/server/middleware/withAuthAndLimit";

import type { RequestContext } from "@/src/contracts/high-level/tenant-context";
import type { Location } from "@/src/contracts/location";
import {
  genericCreate,
  genericDelete,
  genericGetById,
  genericList,
  genericUpdate,
} from "@/server/db/queries/generics";
import { parseBody } from "@/server/utils/parse-body";

async function getHandler(req: Request, ctx: RequestContext) {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  if (action === "get-one") {
    const id = url.searchParams.get("id") ?? "";
    const location = await genericGetById<Location>(
      { table: "location", tenant: ctx.tenantContext.tenant },
      id,
    );
    return Response.json({ success: true, data: location });
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

  const result = await genericList<Location>({
    table: "location",
    searchFields: ["name"],
    limit,
    cursor,
    search,
    tenant: ctx.tenantContext.tenant,
  });

  return Response.json({ success: true, ...result });
}

async function postHandler(req: Request, ctx: RequestContext) {
  const { body, error } = await parseBody(req);
  if (error) return error;
  const { name, description, address } = body;

  if (!name || !address) {
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

  const result = await genericCreate<Location>(
    {
      table: "location",
      tenant: ctx.tenantContext.tenant,
    },
    { name, description: description || undefined, address },
  );

  return Response.json(
    { success: true, data: result.data },
    { status: 201 },
  );
}

async function putHandler(req: Request, ctx: RequestContext) {
  const { body, error } = await parseBody(req);
  if (error) return error;
  const { id, name, description, address } = body;

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
  if (address !== undefined) data.address = address;

  const result = await genericUpdate<Location>(
    { table: "location", tenant: ctx.tenantContext.tenant },
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
    { table: "location", tenant: ctx.tenantContext.tenant },
    id,
  );
  return Response.json({ success: true });
}

export const GET = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 60 },
    roles: ["grexid.list_locations", "admin"],
  }),
  async (req, ctx) => getHandler(req, ctx),
);

export const POST = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 60 },
    roles: ["grexid.manage_locations", "admin"],
  }),
  async (req, ctx) => postHandler(req, ctx),
);

export const PUT = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 60 },
    roles: ["grexid.manage_locations", "admin"],
  }),
  async (req, ctx) => putHandler(req, ctx),
);

export const DELETE = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 60 },
    roles: ["grexid.manage_locations", "admin"],
  }),
  async (req, ctx) => deleteHandler(req, ctx),
);
