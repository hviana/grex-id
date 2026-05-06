import { compose } from "@/server/middleware/compose";
import { withAuthAndLimit } from "@/server/middleware/withAuthAndLimit";

import type { RequestContext } from "@/src/contracts/high-level/tenant-context";
import {
  getDetectionStats,
  listDetections,
} from "@systems/grex-id/server/db/queries/detections";

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
  const tagIdsParam = url.searchParams.get("tagIds");
  const tagIds = tagIdsParam
    ? tagIdsParam.split(",").filter(Boolean)
    : undefined;
  const companyId = ctx.tenantContext.tenant.companyId!;
  const systemId = ctx.tenantContext.tenant.systemId!;

  if (action === "stats") {
    const stats = await getDetectionStats({
      companyId,
      systemId,
      startDate,
      endDate,
      locationId,
      tagIds,
    });
    return Response.json({ success: true, data: stats });
  }

  const cursor = url.searchParams.get("cursor") ?? undefined;
  const limit = Number(url.searchParams.get("limit") ?? "20");

  const result = await listDetections({
    limit,
    cursor,
    companyId,
    systemId,
    startDate,
    endDate,
    locationId,
    tagIds,
  });

  return Response.json({ success: true, ...result });
}

export const GET = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 60 },
    accesses: [{
      systemSlug: "grex-id",
      roles: ["admin", "grexid.view_detections"],
    }],
  }),
  async (req, ctx) => getHandler(req, ctx),
);
