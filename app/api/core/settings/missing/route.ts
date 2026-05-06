import { compose } from "@/server/middleware/compose";
import { withAuthAndLimit } from "@/server/middleware/withAuthAndLimit";

import type { RequestContext } from "@/src/contracts/high-level/tenant-context";
import { getMissingCoreSettings } from "@/server/utils/missing-settings-tracker";

async function getHandler(_req: Request, _ctx: RequestContext) {
  return Response.json({
    success: true,
    data: getMissingCoreSettings(),
  });
}

export const GET = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 100 },
    accesses: [{ roles: ["superuser"] }],
  }),
  getHandler,
);
