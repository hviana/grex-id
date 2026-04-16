import { NextRequest, NextResponse } from "next/server";
import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import { listDetections } from "@/server/db/queries/systems/grex-id/detections";

async function getHandler(req: NextRequest, ctx: RequestContext) {
  const url = new URL(req.url);
  const startDate = url.searchParams.get("startDate");
  const endDate = url.searchParams.get("endDate");

  if (!startDate || !endDate) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "VALIDATION",
          message: "startDate and endDate are required",
        },
      },
      { status: 400 },
    );
  }

  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffDays = (end.getTime() - start.getTime()) / 86400000;

  if (diffDays < 0 || diffDays > 31) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "VALIDATION",
          message: "validation.usage.maxRange",
        },
      },
      { status: 400 },
    );
  }

  const cursor = url.searchParams.get("cursor") ?? undefined;
  const limit = Number(url.searchParams.get("limit") ?? "20");
  const locationId = url.searchParams.get("locationId") ?? undefined;
  const companyId = url.searchParams.get("companyId") || ctx.tenant.companyId;
  const systemId = url.searchParams.get("systemId") || ctx.tenant.systemId;

  const result = await listDetections({
    limit,
    cursor,
    companyId,
    systemId,
    startDate,
    endDate,
    locationId,
  });

  return NextResponse.json({ success: true, ...result });
}

export const GET = compose(
  withRateLimit({ windowMs: 60000, maxRequests: 60 }),
  withAuth(),
  async (req, ctx) => getHandler(req as NextRequest, ctx),
);
