import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import {
  genericCreate,
  genericDelete,
  genericGetById,
  genericList,
  genericUpdate,
} from "@/server/db/queries/generics";

interface Location {
  id: string;
  name: string;
  description?: string;
  companyId: string;
  systemId: string;
  address: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

async function getHandler(req: Request, ctx: RequestContext) {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  if (action === "get-one") {
    const id = url.searchParams.get("id") ?? "";
    const location = await genericGetById<Location>({ table: "location" }, id);
    return Response.json({ success: true, data: location });
  }

  const search = url.searchParams.get("search") ?? undefined;
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const limit = Number(url.searchParams.get("limit") ?? "20");

  const companyId = ctx.tenant.companyId;
  const systemId = ctx.tenant.systemId;

  if (!companyId || !systemId) {
    return Response.json({ success: true, data: [], nextCursor: null });
  }

  const result = await genericList<Location>(
    {
      table: "location",
      searchFields: ["name"],
    },
    { limit, cursor, search, ensureTenant: { companyId, systemId } },
  );

  return Response.json({ success: true, ...result });
}

async function postHandler(req: Request, ctx: RequestContext) {
  const body = await req.json();
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
    !ctx.tenant.companyId || !ctx.tenant.systemId
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
      ensureTenant: {
        companyId: ctx.tenant.companyId,
        systemId: ctx.tenant.systemId,
      },
    },
    { name, description: description || null, address },
  );

  return Response.json(
    { success: true, data: result.data },
    { status: 201 },
  );
}

async function putHandler(req: Request, _ctx: RequestContext) {
  const body = await req.json();
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
  if (description !== undefined) data.description = description || null;
  if (address !== undefined) data.address = address;

  const result = await genericUpdate<Location>(
    { table: "location" },
    id,
    data,
  );

  return Response.json({ success: true, data: result.data });
}

async function deleteHandler(req: Request, _ctx: RequestContext) {
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

  await genericDelete({ table: "location" }, id);
  return Response.json({ success: true });
}

export const GET = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 60 }),
  withAuth({ permissions: ["grexid.list_locations"] }),
  async (req, ctx) => getHandler(req, ctx),
);

export const POST = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 60 }),
  withAuth({ permissions: ["grexid.manage_locations"] }),
  async (req, ctx) => postHandler(req, ctx),
);

export const PUT = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 60 }),
  withAuth({ permissions: ["grexid.manage_locations"] }),
  async (req, ctx) => putHandler(req, ctx),
);

export const DELETE = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 60 }),
  withAuth({ permissions: ["grexid.manage_locations"] }),
  async (req, ctx) => deleteHandler(req, ctx),
);
