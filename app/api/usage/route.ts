import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import { getDb, rid } from "@/server/db/connection";
import { getFS } from "@/server/utils/fs";

async function getHandler(req: Request, ctx: RequestContext) {
  const url = new URL(req.url);
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

  // Default date range: last 31 days
  const end = endDate || new Date().toISOString().slice(0, 10);
  const start = startDate ||
    new Date(Date.now() - 31 * 86400000).toISOString().slice(0, 10);

  // Validate max 31 days
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

  const db = await getDb();

  // Batch: system slug + plan storage limit + voucher modifier + credit expenses (§7.2)
  const configResult = await db.query<
    [
      { slug: string }[],
      { storageLimitBytes: number; voucherId: string | null }[],
      { storageLimitModifier: number }[],
      { resourceKey: string; totalAmount: number; totalCount: number }[],
    ]
  >(
    `SELECT slug FROM ONLY $systemId;
     SELECT plan.storageLimitBytes AS storageLimitBytes, voucherId
       FROM subscription
       WHERE companyId = $companyId AND systemId = $systemId AND status = "active"
       LIMIT 1
       FETCH plan;
     LET $voucherId = (SELECT VALUE voucherId FROM subscription
       WHERE companyId = $companyId AND systemId = $systemId AND status = "active"
       LIMIT 1)[0];
     IF $voucherId != NONE {
       SELECT storageLimitModifier FROM voucher WHERE id = $voucherId LIMIT 1;
     } ELSE {
       SELECT NONE FROM NONE;
     };
     SELECT resourceKey, math::sum(amount) AS totalAmount, math::sum(count) AS totalCount FROM credit_expense
       WHERE companyId = $companyId AND systemId = $systemId
         AND day >= $startDate AND day <= $endDate
       GROUP BY resourceKey
       ORDER BY totalAmount DESC`,
    {
      systemId: rid(systemId),
      companyId: rid(companyId),
      startDate: start,
      endDate: end,
    },
  );

  const systemSlug = (configResult[0] as unknown as { slug?: string }[])
    ?.[0]?.slug;
  const subRow = (configResult[1] as unknown[])?.[0] as {
    storageLimitBytes?: number;
  } | undefined;

  // Calculate storage usage via SurrealFS readDir
  let usedBytes = 0;
  if (systemSlug) {
    const fs = await getFS();
    let cursor: unknown = undefined;
    do {
      const listing = await fs.readDir({
        path: [companyId, systemSlug],
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

  let storageLimitBytes = subRow?.storageLimitBytes ?? 1073741824;
  storageLimitBytes +=
    (configResult[2]?.[0] as unknown as { storageLimitModifier?: number })
      ?.storageLimitModifier ?? 0;

  const creditExpenses = configResult[3] ?? [];

  return Response.json({
    success: true,
    data: {
      storage: {
        usedBytes,
        limitBytes: storageLimitBytes,
      },
      creditExpenses,
    },
  });
}

export const GET = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 60 }),
  withAuth({ requireAuthenticated: true }),
  async (req, ctx) => getHandler(req, ctx),
);
