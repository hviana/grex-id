import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import {
  getDetectionStats,
  listDetections,
} from "@/server/db/queries/systems/grex-id/detections";

async function getHandler(req: Request, ctx: RequestContext) {
  const url = new URL(req.url);
  const startDate = url.searchParams.get("startDate");
  const endDate = url.searchParams.get("endDate");

  if (!startDate || !endDate) {
    return Response.json(
      {
        success: false,
        error: {
          code: "VALIDATION",
          errors: ["validation.dateRange.required"],
        },
      },
      { status: 400 },
    );
  }

  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffDays = (end.getTime() - start.getTime()) / 86400000;

  if (diffDays < 0 || diffDays > 31) {
    return Response.json(
      {
        success: false,
        error: {
          code: "VALIDATION",
          errors: ["validation.usage.maxRange"],
        },
      },
      { status: 400 },
    );
  }

  const action = url.searchParams.get("action");
  const locationId = url.searchParams.get("locationId") ?? undefined;
  const tenantId = ctx.tenant.id;

  if (action === "stats") {
    const stats = await getDetectionStats({
      tenantId,
      startDate,
      endDate,
      locationId,
    });
    return Response.json({ success: true, data: stats });
  }

  const cursor = url.searchParams.get("cursor") ?? undefined;
  const limit = Number(url.searchParams.get("limit") ?? "20");

  const result = await listDetections({
    limit,
    cursor,
    tenantId,
    startDate,
    endDate,
    locationId,
  });

  return Response.json({ success: true, ...result });
}

export const GET = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 60 }),
  withAuth({ roles: ["grexid.view_detections"] }),
  async (req, ctx) => getHandler(req, ctx),
);
