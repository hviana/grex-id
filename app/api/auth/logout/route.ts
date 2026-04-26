import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import { forgetActor } from "@/server/utils/actor-validity";

async function handler(
  _req: Request,
  ctx: RequestContext,
): Promise<Response> {
  if (ctx.tenant.actorType === "user" && ctx.tenant.actorId) {
    await forgetActor(ctx.tenant.id, String(ctx.tenant.actorId));
  }
  return Response.json({ success: true });
}

export const POST = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 60 }),
  withAuth({ requireAuthenticated: true }),
  handler,
);
