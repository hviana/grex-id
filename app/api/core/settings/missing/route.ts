import { compose } from "@/server/middleware/compose";
import { withAuthAndLimit } from "@/server/middleware/withAuthAndLimit";

import type { RequestContext } from "@/src/contracts/high-level/tenant-context";
import Core from "@/server/utils/Core";

async function getHandler(_req: Request, _ctx: RequestContext) {
  const core = Core.getInstance();
  return Response.json({
    success: true,
    data: await core.getMissingSettings(),
  });
}

export const GET = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 100 },
    roles: ["superuser"],
  }),
  getHandler,
);
