import { compose } from "@/server/middleware/compose";
import { withAuthAndLimit } from "@/server/middleware/withAuthAndLimit";
import type { RequestContext } from "@/src/contracts/high-level/tenant-context";
import { standardizeField } from "@/server/utils/field-standardizer";
import { validateField } from "@/server/utils/field-validator";
import {
  genericCreate,
  genericDelete,
  genericList,
} from "@/server/db/queries/generics";
import type { ConnectedService } from "@/src/contracts/connected-service";
import { parseBody } from "@/server/utils/parse-body";

async function getHandler(req: Request, ctx: RequestContext) {
  const url = new URL(req.url);
  const search = url.searchParams.get("search") || undefined;

  const result = await genericList<ConnectedService>({
    table: "connected_service",
    select: "id, name, data, tenantIds, createdAt, updatedAt",
    searchFields: ["name"],
    limit: 50,
    tenant: ctx.tenantContext.tenant,
    search,
  });
  return Response.json({ success: true, ...result });
}

async function postHandler(req: Request, ctx: RequestContext) {
  const { body, error } = await parseBody(req);
  if (error) return error;
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

  if (!ctx.tenantContext.tenant.actorId) {
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
      tenant: ctx.tenantContext.tenant,
      fields: [{ field: "name" }, { field: "data" }],
    },
    {
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
  const { body, error } = await parseBody(req);
  if (error) return error;
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
    { table: "connected_service", tenant: ctx.tenantContext.tenant },
    id,
  );
  return Response.json({ success: true });
}

export const GET = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 60 },
    requireAuthenticated: true,
  }),
  getHandler,
);

export const POST = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 60 },
    requireAuthenticated: true,
  }),
  postHandler,
);

export const DELETE = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 60 },
    requireAuthenticated: true,
  }),
  deleteHandler,
);
