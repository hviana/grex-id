import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import {
  getAllSettings,
  upsertSettings,
} from "@/server/db/queries/systems/grex-id/settings";

async function getHandler(req: Request, ctx: RequestContext) {
  const url = new URL(req.url);
  const companyId = url.searchParams.get("companyId") || ctx.tenant.companyId;
  const systemId = url.searchParams.get("systemId") || ctx.tenant.systemId;
  const settings = await getAllSettings(companyId, systemId);
  return Response.json({ success: true, data: settings });
}

async function putHandler(req: Request, ctx: RequestContext) {
  const body = await req.json();
  const { settings, companyId: bodyCompanyId, systemId: bodySystemId } = body;
  const companyId = bodyCompanyId || ctx.tenant.companyId;
  const systemId = bodySystemId || ctx.tenant.systemId;

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

  const updated = await upsertSettings(companyId, systemId, normalized);
  return Response.json({ success: true, data: updated });
}

export const GET = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 60 }),
  withAuth({ requireAuthenticated: true }),
  async (req, ctx) => getHandler(req, ctx),
);

export const PUT = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 60 }),
  withAuth({ requireAuthenticated: true }),
  async (req, ctx) => putHandler(req, ctx),
);
