import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import { standardizeField } from "@/server/utils/field-standardizer";
import { validateField } from "@/server/utils/field-validator";
import {
  createConnectedService,
  deleteConnectedService,
  listConnectedServices,
} from "@/server/db/queries/connected-services";

async function getHandler(req: Request, ctx: RequestContext) {
  const url = new URL(req.url);
  const search = url.searchParams.get("search") || undefined;
  const isAdmin = ctx.tenant.roles.includes("admin") ||
    ctx.tenant.roles.includes("superuser");

  const userId = isAdmin ? undefined : ctx.claims?.actorId;

  const data = await listConnectedServices({
    companyId: ctx.tenant.companyId,
    systemId: ctx.tenant.systemId,
    userId,
    search,
  });
  return Response.json({ success: true, data });
}

async function postHandler(req: Request, ctx: RequestContext) {
  const body = await req.json();
  const { name, data: serviceData } = body;

  const stdName = standardizeField("name", name ?? "", "connected_service");
  const errors = validateField("name", stdName, "connected_service");
  if (errors.length > 0) {
    return Response.json(
      {
        success: false,
        error: { code: "VALIDATION", message: errors[0] },
      },
      { status: 400 },
    );
  }

  if (!ctx.claims?.actorId) {
    return Response.json(
      {
        success: false,
        error: { code: "UNAUTHORIZED", message: "common.error.generic" },
      },
      { status: 401 },
    );
  }

  const created = await createConnectedService({
    userId: ctx.claims.actorId,
    name: stdName,
    companyId: ctx.tenant.companyId,
    systemId: ctx.tenant.systemId,
    serviceData,
  });

  if (!created) {
    return Response.json(
      {
        success: false,
        error: { code: "ERROR", message: "common.error.generic" },
      },
      { status: 500 },
    );
  }

  return Response.json({ success: true, data: created }, { status: 201 });
}

async function deleteHandler(req: Request, _ctx: RequestContext) {
  const body = await req.json();
  const { id } = body;

  if (!id) {
    return Response.json(
      {
        success: false,
        error: { code: "VALIDATION", message: "validation.id.required" },
      },
      { status: 400 },
    );
  }

  await deleteConnectedService(id);
  return Response.json({ success: true });
}

export const GET = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 60 }),
  withAuth({ requireAuthenticated: true }),
  async (req, ctx) => getHandler(req, ctx),
);

export const POST = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 60 }),
  withAuth({ requireAuthenticated: true }),
  async (req, ctx) => postHandler(req, ctx),
);

export const DELETE = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 60 }),
  withAuth({ requireAuthenticated: true }),
  async (req, ctx) => deleteHandler(req, ctx),
);
