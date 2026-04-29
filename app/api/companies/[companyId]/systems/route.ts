import { compose } from "@/server/middleware/compose";
import { withAuthAndLimit } from "@/server/middleware/withAuthAndLimit";

import type { RequestContext } from "@/src/contracts/high-level/tenant-context";
import { genericList } from "@/server/db/queries/generics";
import { rid } from "@/server/db/connection";

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

  const result = await genericList({
    table: "system",
    extraConditions: [
      "id IN (SELECT VALUE systemId FROM tenant WHERE companyId = $companyId AND !actorId AND systemId)",
    ],
    extraBindings: { companyId: rid(companyId) },
    limit: 200,
  });

  return Response.json({ success: true, data: result.items });
}

export const GET = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 60 },
  }),
  async (req, ctx) => getHandler(req, ctx),
);
