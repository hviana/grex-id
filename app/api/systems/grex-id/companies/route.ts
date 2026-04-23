import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import { searchUserCompaniesBySystem } from "@/server/db/queries/systems/grex-id/companies";

async function getHandler(req: Request, ctx: RequestContext) {
  const url = new URL(req.url);
  const search = url.searchParams.get("q") ?? "";

  if (!search || search.length < 2) {
    return Response.json({ success: true, data: [] });
  }

  try {
    const data = await searchUserCompaniesBySystem({
      systemSlug: ctx.tenant.systemSlug,
      userId: ctx.claims!.actorId,
      search,
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
