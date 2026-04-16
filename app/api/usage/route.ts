import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import { getDb, rid } from "@/server/db/connection";
import { getFS } from "@/server/utils/fs";

async function getHandler(req: Request, ctx: RequestContext) {
  const url = new URL(req.url);
  const companyId = url.searchParams.get("companyId") || ctx.tenant.companyId;
  const systemId = url.searchParams.get("systemId") || ctx.tenant.systemId;
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

  // Resolve systemSlug from systemId (upload paths use slug, not ID)
  const systemResult = await db.query<[{ slug: string }[]]>(
    `SELECT slug FROM ONLY $systemId`,
    { systemId: rid(systemId) },
  );
  const systemSlug = (systemResult[0] as unknown as { slug?: string })?.slug;

  // Calculate storage usage via SurrealFS readDir (path matches upload convention: [companyId, systemSlug, ...])
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

  // Query: plan storage limit + single voucher modifier
  const planResult = await db.query<
    [{ storageLimitBytes: number; voucherId: string | null }[]]
  >(
    `SELECT plan.storageLimitBytes AS storageLimitBytes, voucherId
       FROM subscription
       WHERE companyId = $companyId AND systemId = $systemId AND status = "active"
       LIMIT 1
       FETCH plan`,
    {
      companyId: rid(companyId),
      systemId: rid(systemId),
    },
  );

  let storageLimitBytes = 1073741824; // 1GB default
  const subRow = (planResult[0] as unknown[])?.[0] as {
    storageLimitBytes?: number;
    voucherId?: string | null;
  } | undefined;
  if (subRow?.storageLimitBytes) {
    storageLimitBytes = subRow.storageLimitBytes;
  }
  if (subRow?.voucherId) {
    const voucherResult = await db.query<[{ storageLimitModifier: number }[]]>(
      `SELECT storageLimitModifier FROM voucher WHERE id = $id LIMIT 1`,
      { id: subRow.voucherId },
    );
    storageLimitBytes += ((voucherResult[0] as unknown[])?.[0] as
      | { storageLimitModifier?: number }
      | undefined)
      ?.storageLimitModifier ?? 0;
  }

  // Query: credit expenses
  const creditResult = await db.query<
    [{ resourceKey: string; totalAmount: number }[]]
  >(
    `SELECT resourceKey, math::sum(amount) AS totalAmount FROM credit_expense
       WHERE companyId = $companyId AND systemId = $systemId
         AND day >= $startDate AND day <= $endDate
       GROUP BY resourceKey
       ORDER BY totalAmount DESC`,
    {
      companyId: rid(companyId),
      systemId: rid(systemId),
      startDate: start,
      endDate: end,
    },
  );

  const creditExpenses = creditResult[0] ?? [];

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
