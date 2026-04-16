import { NextRequest, NextResponse } from "next/server";
import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import {
  createLocation,
  deleteLocation,
  getLocationById,
  listLocations,
  updateLocation,
} from "@/server/db/queries/locations";

async function getHandler(req: NextRequest, ctx: RequestContext) {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  if (action === "get-one") {
    const id = url.searchParams.get("id") ?? "";
    const location = await getLocationById(id);
    return NextResponse.json({ success: true, data: location });
  }

  const search = url.searchParams.get("search") ?? undefined;
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const limit = Number(url.searchParams.get("limit") ?? "20");
  const companyId = url.searchParams.get("companyId") || ctx.tenant.companyId;
  const systemId = url.searchParams.get("systemId") || ctx.tenant.systemId;

  const result = await listLocations({
    limit,
    cursor,
    search,
    companyId,
    systemId,
  });

  return NextResponse.json({ success: true, ...result });
}

async function postHandler(req: NextRequest, ctx: RequestContext) {
  const body = await req.json();
  const { name, description, address, companyId, systemId } = body;

  const resolvedCompanyId = companyId || ctx.tenant.companyId;
  const resolvedSystemId = systemId || ctx.tenant.systemId;

  if (!name || !address || !resolvedCompanyId || !resolvedSystemId) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "VALIDATION", message: "validation.fields.required" },
      },
      { status: 400 },
    );
  }

  const location = await createLocation({
    name,
    description,
    companyId: resolvedCompanyId,
    systemId: resolvedSystemId,
    address,
  });

  return NextResponse.json(
    { success: true, data: location },
    { status: 201 },
  );
}

async function putHandler(req: NextRequest, _ctx: RequestContext) {
  const body = await req.json();
  const { id, name, description, address } = body;

  if (!id) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "VALIDATION", message: "validation.id.required" },
      },
      { status: 400 },
    );
  }

  const location = await updateLocation(id, { name, description, address });
  return NextResponse.json({ success: true, data: location });
}

async function deleteHandler(req: NextRequest, _ctx: RequestContext) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";

  if (!id) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "VALIDATION", message: "validation.id.required" },
      },
      { status: 400 },
    );
  }

  await deleteLocation(id);
  return NextResponse.json({ success: true });
}

const readPipeline = compose(
  withRateLimit({ windowMs: 60000, maxRequests: 60 }),
  withAuth({ permissions: ["grexid.list_locations"] }),
);

const writePipeline = compose(
  withRateLimit({ windowMs: 60000, maxRequests: 60 }),
  withAuth(),
);

export const GET = compose(
  readPipeline,
  async (req, ctx) => getHandler(req as NextRequest, ctx),
);

export const POST = compose(
  writePipeline,
  async (req, ctx) => postHandler(req as NextRequest, ctx),
);

export const PUT = compose(
  writePipeline,
  async (req, ctx) => putHandler(req as NextRequest, ctx),
);

export const DELETE = compose(
  writePipeline,
  async (req, ctx) => deleteHandler(req as NextRequest, ctx),
);
