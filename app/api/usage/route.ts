import { NextRequest, NextResponse } from "next/server";
import { getDb, rid } from "@/server/db/connection";
import { getFS } from "@/server/utils/fs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const companyId = url.searchParams.get("companyId");
  const systemId = url.searchParams.get("systemId");
  const startDate = url.searchParams.get("startDate");
  const endDate = url.searchParams.get("endDate");

  if (!companyId || !systemId) {
    return NextResponse.json(
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

  // Query: plan storage limit + voucher modifiers
  const planResult = await db.query<
    [{ storageLimitBytes: number; voucherIds: string[] }[]]
  >(
    `SELECT plan.storageLimitBytes AS storageLimitBytes, voucherIds
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
    voucherIds?: string[];
  } | undefined;
  if (subRow?.storageLimitBytes) {
    storageLimitBytes = subRow.storageLimitBytes;
  }
  if (subRow?.voucherIds?.length) {
    const voucherResult = await db.query<[{ total: number }[]]>(
      `SELECT math::sum(storageLimitModifier) AS total FROM voucher
         WHERE id IN $ids GROUP ALL`,
      { ids: subRow.voucherIds },
    );
    storageLimitBytes +=
      ((voucherResult[0] as unknown[])?.[0] as { total?: number } | undefined)
        ?.total ?? 0;
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

  return NextResponse.json({
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
