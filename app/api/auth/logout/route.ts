import { compose } from "@/server/middleware/compose";
import { withAuthAndLimit } from "@/server/middleware/withAuthAndLimit";
import type { RequestContext } from "@/src/contracts/high_level/tenant-context";
import { forgetActor } from "@/server/utils/actor-validity";

async function handler(
  _req: Request,
  ctx: RequestContext,
): Promise<Response> {
  const { tenant } = ctx.tenantContext;
  const actorType = ctx.tenantContext.actorType;

  if (actorType === "user" && tenant.actorId) {
    await forgetActor(tenant);
  }
  return Response.json({ success: true });
}

export const POST = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 60 },
    requireAuthenticated: true,
  }),
  handler,
);
