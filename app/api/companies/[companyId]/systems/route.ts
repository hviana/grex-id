import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import { getDb, rid } from "@/server/db/connection";

async function getHandler(req: Request, ctx: RequestContext) {
  // Extract companyId from URL path for Next.js dynamic route compatibility
  const url = new URL(req.url);
  const segments = url.pathname.split("/");
  const companyIdIdx = segments.indexOf("companies") + 1;
  const companyId = segments[companyIdIdx] ?? "";

  if (!companyId) {
    return Response.json(
      {
        success: false,
        error: { code: "VALIDATION", message: "validation.companyId.required" },
      },
      { status: 400 },
    );
  }

  const db = await getDb();

  const result = await db.query<[{ systemId: string }[]]>(
    `SELECT systemId FROM company_system WHERE companyId = $companyId`,
    { companyId: rid(companyId) },
  );

  const systemIds = (result[0] ?? []).map((r) => r.systemId);

  if (systemIds.length === 0) {
    return Response.json({ success: true, data: [] });
  }

  const systems = await db.query<[Record<string, unknown>[]]>(
    `SELECT * FROM system WHERE id IN $ids`,
    { ids: systemIds },
  );

  return Response.json({ success: true, data: systems[0] ?? [] });
}

export const GET = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 60 }),
  withAuth({ requireAuthenticated: true }),
  async (req, ctx) => getHandler(req, ctx),
);
