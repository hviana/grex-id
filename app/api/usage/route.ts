import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import { getFS } from "@/server/utils/fs";
import FileCacheManager from "@/server/utils/file-cache";
import { resolveFileCacheLimit } from "@/server/utils/guards";
import {
  getCoreCreditExpenses,
  getOperationCount,
  getTenantUsageConfig,
} from "@/server/db/queries/usage";

async function getHandler(req: Request, ctx: RequestContext) {
  const url = new URL(req.url);
  const action = url.searchParams.get("mode");

  // ── Core mode: superuser cross-tenant aggregation ──
  if (action === "core") {
    if (!ctx.tenant.roles.includes("superuser")) {
      return Response.json(
        {
          success: false,
          error: { code: "ERROR", message: "common.error.forbidden" },
        },
        { status: 403 },
      );
    }

    const startDate = url.searchParams.get("startDate") ||
      new Date(Date.now() - 31 * 86400000).toISOString().slice(0, 10);
    const endDate = url.searchParams.get("endDate") ||
      new Date().toISOString().slice(0, 10);

    const diffMs = new Date(endDate).getTime() - new Date(startDate).getTime();
    if (diffMs > 31 * 86400000) {
      return Response.json(
        {
          success: false,
          error: { code: "VALIDATION", message: "validation.usage.maxRange" },
        },
        { status: 400 },
      );
    }

    const companyIdsParam = url.searchParams.get("companyIds");
    const systemIdsParam = url.searchParams.get("systemIds");
    const planIdsParam = url.searchParams.get("planIds");
    const actorIdsParam = url.searchParams.get("actorIds");

    const creditExpenses = await getCoreCreditExpenses({
      startDate,
      endDate,
      companyIds: companyIdsParam
        ? companyIdsParam.split(",").filter(Boolean)
        : undefined,
      systemIds: systemIdsParam
        ? systemIdsParam.split(",").filter(Boolean)
        : undefined,
      planIds: planIdsParam
        ? planIdsParam.split(",").filter(Boolean)
        : undefined,
      actorIds: actorIdsParam
        ? actorIdsParam.split(",").filter(Boolean)
        : undefined,
    });

    return Response.json({
      success: true,
      data: { creditExpenses },
    });
  }

  // ── Tenant mode ──
  const companyId = ctx.tenant.companyId;
  const systemId = ctx.tenant.systemId;
  const startDate = url.searchParams.get("startDate");
  const endDate = url.searchParams.get("endDate");

  if (!companyId || !systemId || companyId === "0" || systemId === "0") {
    return Response.json(
      {
        success: false,
        error: {
          code: "VALIDATION",
          message: "validation.usage.companyAndSystem",
        },
      },
      { status: 400 },
    );
  }

  const end = endDate || new Date().toISOString().slice(0, 10);
  const start = startDate ||
    new Date(Date.now() - 31 * 86400000).toISOString().slice(0, 10);

  const diffMs = new Date(end).getTime() - new Date(start).getTime();
  if (diffMs > 31 * 86400000) {
    return Response.json(
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

  const config = await getTenantUsageConfig({
    systemId,
    companyId,
    startDate: start,
    endDate: end,
  });

  let usedBytes = 0;
  if (config.systemSlug) {
    const fs = await getFS();
    let cursor: unknown = undefined;
    do {
      const listing = await fs.readDir({
        path: [companyId, config.systemSlug],
        control: () => ({
          accessAllowed: true,
          maxPageSize: 1000,
          cursor,
        }),
      });
      usedBytes += listing.size;
      cursor = listing.cursor;
    } while (cursor);
  }

  let storageLimitBytes = config.subscriptionStorageLimit ?? 1073741824;
  storageLimitBytes += config.voucherStorageModifier;

  const cacheLimitResult = await resolveFileCacheLimit({ companyId, systemId });
  const tenantKey = config.systemSlug
    ? `${companyId}:${config.systemSlug}`
    : null;
  const cacheStats = tenantKey
    ? FileCacheManager.getInstance().getStats(
      tenantKey,
      cacheLimitResult.maxBytes,
    )
    : { usedBytes: 0, maxBytes: cacheLimitResult.maxBytes, fileCount: 0 };

  const creditExpenses = config.creditExpenses;

  const operationCount = await getOperationCount(companyId, systemId);

  return Response.json({
    success: true,
    data: {
      storage: {
        usedBytes,
        limitBytes: storageLimitBytes,
      },
      cache: cacheStats,
      creditExpenses,
      operationCount,
    },
  });
}

export const GET = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 60 }),
  withAuth({ requireAuthenticated: true }),
  async (req, ctx) => getHandler(req, ctx),
);
