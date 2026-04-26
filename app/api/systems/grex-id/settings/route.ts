import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import {
  getAllSettings,
  upsertSettings,
} from "@/server/db/queries/systems/grex-id/settings";

async function getHandler(_req: Request, ctx: RequestContext) {
  if (!ctx.tenant.companyId || !ctx.tenant.systemId) {
    return Response.json({ success: true, data: [] });
  }
  const settings = await getAllSettings(
    ctx.tenant.companyId,
    ctx.tenant.systemId,
  );
  return Response.json({ success: true, data: settings });
}

async function putHandler(req: Request, ctx: RequestContext) {
  if (!ctx.tenant.companyId || !ctx.tenant.systemId) {
    return Response.json(
      {
        success: false,
        error: {
          code: "VALIDATION",
          message: "validation.billing.companyAndSystem",
        },
      },
      { status: 400 },
    );
  }
  const body = await req.json();
  const { settings } = body;

  if (!settings || typeof settings !== "object") {
    return Response.json(
      {
        success: false,
        error: { code: "VALIDATION", message: "validation.settings.required" },
      },
      { status: 400 },
    );
  }

  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(settings)) {
    normalized[key] = String(value);
  }

  const updated = await upsertSettings(
    ctx.tenant.companyId,
    ctx.tenant.systemId,
    normalized,
  );
  return Response.json({ success: true, data: updated });
}

export const GET = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 60 }),
  withAuth({ roles: ["grexid.manage_settings"] }),
  async (req, ctx) => getHandler(req, ctx),
);

export const PUT = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 60 }),
  withAuth({ roles: ["grexid.manage_settings"] }),
  async (req, ctx) => putHandler(req, ctx),
);
