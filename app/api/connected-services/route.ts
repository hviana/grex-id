import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import { standardizeField } from "@/server/utils/field-standardizer";
import { validateField } from "@/server/utils/field-validator";
import {
  genericCreate,
  genericDelete,
  genericList,
} from "@/server/db/queries/generics";
import { rid } from "@/server/db/connection";
import type { ConnectedService } from "@/src/contracts/connected-service";

async function getHandler(req: Request, ctx: RequestContext) {
  const url = new URL(req.url);
  const search = url.searchParams.get("search") || undefined;
  const isAdmin = ctx.tenant.roles.includes("admin") ||
    ctx.tenant.roles.includes("superuser");

  // Admin sees all services in the tenant; regular users are filtered
  // by their own userId via extraConditions.
  const extraConditions: string[] = [];
  const extraBindings: Record<string, unknown> = {};

  if (!isAdmin) {
    extraConditions.push("userId = $userId");
    extraBindings.userId = rid(ctx.tenant.actorId!);
  }

  const result = await genericList<ConnectedService>({
    table: "connected_service",
    select: isAdmin ? "*, userId.profile.name AS userName" : "*",
    searchFields: ["name"],
    fetch: "userId.profile",
    limit: 50,
    extraConditions,
    extraBindings,
    tenant: ctx.tenant,
    search,
  });
  return Response.json({ success: true, ...result });
}

async function postHandler(req: Request, ctx: RequestContext) {
  const body = await req.json();
  const { name, data: serviceData } = body;

  const stdName = await standardizeField(
    "name",
    name ?? "",
    "connected_service",
  );
  const errors = await validateField("name", stdName, "connected_service");
  if (errors.length > 0) {
    return Response.json(
      {
        success: false,
        error: { code: "VALIDATION", message: errors[0] },
      },
      { status: 400 },
    );
  }

  if (!ctx.tenant.actorId) {
    return Response.json(
      {
        success: false,
        error: { code: "UNAUTHORIZED", message: "common.error.generic" },
      },
      { status: 401 },
    );
  }

  const result = await genericCreate<ConnectedService>(
    {
      table: "connected_service",
      tenant: ctx.tenant,
    },
    {
      userId: rid(ctx.tenant.actorId!),
      name: stdName,
      data: serviceData ?? undefined,
    },
  );

  if (!result.success || !result.data) {
    return Response.json(
      {
        success: false,
        error: { code: "ERROR", message: "common.error.generic" },
      },
      { status: 500 },
    );
  }

  return Response.json({ success: true, data: result.data }, { status: 201 });
}

async function deleteHandler(req: Request, ctx: RequestContext) {
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

  await genericDelete(
    { table: "connected_service", tenant: ctx.tenant },
    id,
  );
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
