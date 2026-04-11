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

const readPipeline = compose(
  withRateLimit({ windowMs: 60000, maxRequests: 60 }),
  withAuth({ permissions: ["grexid.list_locations"] }),
);

const writePipeline = compose(
  withRateLimit({ windowMs: 60000, maxRequests: 60 }),
  withAuth(),
);

export async function GET(req: NextRequest) {
  const ctx: RequestContext = {
    userId: "",
    companyId: "",
    systemId: "",
    roles: [],
    permissions: [],
  };

  return readPipeline(req, ctx, async () => {
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
    const companyId = url.searchParams.get("companyId") || ctx.companyId;
    const systemId = url.searchParams.get("systemId") || ctx.systemId;

    const result = await listLocations({
      limit,
      cursor,
      search,
      companyId,
      systemId,
    });

    return NextResponse.json({ success: true, ...result });
  });
}

export async function POST(req: NextRequest) {
  const ctx: RequestContext = {
    userId: "",
    companyId: "",
    systemId: "",
    roles: [],
    permissions: [],
  };

  return writePipeline(req, ctx, async () => {
    const body = await req.json();
    const { name, description, address, companyId, systemId } = body;

    const resolvedCompanyId = companyId || ctx.companyId;
    const resolvedSystemId = systemId || ctx.systemId;

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
  });
}

export async function PUT(req: NextRequest) {
  const ctx: RequestContext = {
    userId: "",
    companyId: "",
    systemId: "",
    roles: [],
    permissions: [],
  };

  return writePipeline(req, ctx, async () => {
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
  });
}

export async function DELETE(req: NextRequest) {
  const ctx: RequestContext = {
    userId: "",
    companyId: "",
    systemId: "",
    roles: [],
    permissions: [],
  };

  return writePipeline(req, ctx, async () => {
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
  });
}
