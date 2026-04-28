import { compose } from "@/server/middleware/compose";

import { withAuthAndLimit } from "@/server/middleware/withAuthAndLimit";
import type { RequestContext } from "@/src/contracts/high_level/tenant-context";
import {
  getRevenueChart,
  listCoreCompanies,
} from "@/server/db/queries/core-companies";

async function getHandler(req: Request, _ctx: RequestContext) {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  if (action === "chart") {
    const startDate = url.searchParams.get("startDate") || "";
    const endDate = url.searchParams.get("endDate") || "";
    const systemIdsParam = url.searchParams.get("systemIds");
    const planIdsParam = url.searchParams.get("planIds");
    const statusesParam = url.searchParams.get("statuses");

    if (!startDate || !endDate) {
      return Response.json({
        success: true,
        data: { canceled: 0, paid: 0, projected: 0, errors: 0 },
      });
    }

    try {
      const chart = await getRevenueChart({
        startDate,
        endDate,
        systemIds: systemIdsParam
          ? systemIdsParam.split(",").filter(Boolean)
          : undefined,
        planIds: planIdsParam
          ? planIdsParam.split(",").filter(Boolean)
          : undefined,
        statuses: statusesParam
          ? statusesParam.split(",").filter(Boolean)
          : undefined,
      });

      return Response.json({ success: true, data: chart });
    } catch (e) {
      console.error(
        "[core/companies GET chart] error:",
        e instanceof Error ? e.message : String(e),
      );
      return Response.json(
        {
          success: false,
          error: { code: "SERVER_ERROR", message: "common.error.generic" },
        },
        { status: 500 },
      );
    }
  }

  const search = url.searchParams.get("search") ?? undefined;
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "20"), 200);
  const systemIdsParam = url.searchParams.get("systemIds");
  const planIdsParam = url.searchParams.get("planIds");
  const statusesParam = url.searchParams.get("statuses");

  try {
    const result = await listCoreCompanies({
      search,
      cursor,
      limit,
      systemIds: systemIdsParam
        ? systemIdsParam.split(",").filter(Boolean)
        : undefined,
      planIds: planIdsParam
        ? planIdsParam.split(",").filter(Boolean)
        : undefined,
      statuses: statusesParam
        ? statusesParam.split(",").filter(Boolean)
        : undefined,
    });

    return Response.json({ success: true, ...result });
  } catch (e) {
    console.error(
      "[core/companies GET list] error:",
      e instanceof Error ? e.message : String(e),
    );
    return Response.json(
      {
        success: false,
        error: { code: "SERVER_ERROR", message: "common.error.generic" },
      },
      { status: 500 },
    );
  }
}

export const GET = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 100 },
    roles: ["superuser"],
  }),
  getHandler,
);
