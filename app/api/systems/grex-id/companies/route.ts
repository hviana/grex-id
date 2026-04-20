import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import { getDb, normalizeRecordId } from "@/server/db/connection";

async function getHandler(req: Request, ctx: RequestContext) {
  const url = new URL(req.url);
  const search = url.searchParams.get("q") ?? "";

  if (!search || search.length < 2) {
    return Response.json({ success: true, data: [] });
  }

  try {
    const db = await getDb();
    // Scope to companies the current user has access to via company_user
    const result = await db.query<
      [unknown[], { id: string; companyId: { id: string; name: string } }[]]
    >(
      `LET $sys = (SELECT id FROM system WHERE slug = $systemSlug LIMIT 1);
       SELECT companyId FROM company_system
       WHERE systemId = $sys[0].id
         AND companyId IN (SELECT companyId FROM company_user WHERE userId = $userId)
       FETCH companyId;`,
      { systemSlug: ctx.tenant.systemSlug, userId: ctx.claims!.actorId },
    );

    const rows = result[1] ?? [];
    const searchLower = search.toLowerCase();
    const data = rows
      .filter((row) => {
        const company = row.companyId as
          | { id: string; name: string }
          | undefined;
        return company?.name?.toLowerCase().includes(searchLower);
      })
      .slice(0, 20)
      .map((row) => {
        const company = row.companyId as { id: string; name: string };
        return {
          id: normalizeRecordId(company.id) ?? company.id,
          label: company.name,
        };
      });

    return Response.json({ success: true, data });
  } catch {
    return Response.json(
      {
        success: false,
        error: { code: "ERROR", message: "common.error.generic" },
      },
      { status: 500 },
    );
  }
}

export const GET = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 60 }),
  withAuth({ requireAuthenticated: true }),
  async (req, ctx) => getHandler(req, ctx),
);
