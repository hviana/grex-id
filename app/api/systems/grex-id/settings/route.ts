import { NextRequest, NextResponse } from "next/server";
import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import {
  getAllSettings,
  upsertSettings,
} from "@/server/db/queries/systems/grex-id/settings";

const pipeline = compose(
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

  return pipeline(req, ctx, async () => {
    const url = new URL(req.url);
    const companyId = url.searchParams.get("companyId") || ctx.companyId;
    const systemId = url.searchParams.get("systemId") || ctx.systemId;
    const settings = await getAllSettings(companyId, systemId);
    return NextResponse.json({ success: true, data: settings });
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

  return pipeline(req, ctx, async () => {
    const body = await req.json();
    const { settings, companyId: bodyCompanyId, systemId: bodySystemId } = body;
    const companyId = bodyCompanyId || ctx.companyId;
    const systemId = bodySystemId || ctx.systemId;

    if (!settings || typeof settings !== "object") {
      return NextResponse.json(
        {
          success: false,
          error: { code: "VALIDATION", message: "settings object is required" },
        },
        { status: 400 },
      );
    }

    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(settings)) {
      normalized[key] = String(value);
    }

    const updated = await upsertSettings(companyId, systemId, normalized);
    return NextResponse.json({ success: true, data: updated });
  });
}
