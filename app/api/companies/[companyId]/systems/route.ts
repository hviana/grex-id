import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import { getCompanySystems } from "@/server/db/queries/companies";

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

  const systems = await getCompanySystems(companyId);

  return Response.json({ success: true, data: systems });
}

export const GET = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 60 }),
  withAuth({ requireAuthenticated: true }),
  async (req, ctx) => getHandler(req, ctx),
);
