import { compose } from "@/server/middleware/compose";
import { withAuthAndLimit } from "@/server/middleware/withAuthAndLimit";

import type { RequestContext } from "@/src/contracts/high-level/tenant-context";
import {
  genericCreate,
  genericDelete,
  genericList,
  genericUpdate,
} from "@/server/db/queries/generics";
import type { TenantData } from "@/src/contracts/tenant-data";
import { parseBody } from "@/server/utils/parse-body";
import { csTenant } from "@/server/utils/cs-tenant";
import { revalidateTenantCache } from "@/server/utils/cache";

async function getHandler(req: Request, ctx: RequestContext) {
  if (
    !ctx.tenantContext.tenant.companyId ||
    !ctx.tenantContext.tenant.systemId
  ) {
    return Response.json({ success: true, data: null });
  }

  const result = await genericList<TenantData>({
    table: "tenant_data",
    select: "id, data, createdAt, updatedAt",
    tenant: csTenant(ctx),
    limit: 1,
  });

  const row = result.items[0] ?? null;
  return Response.json({ success: true, data: row });
}

async function putHandler(req: Request, ctx: RequestContext) {
  if (
    !ctx.tenantContext.tenant.companyId ||
    !ctx.tenantContext.tenant.systemId
  ) {
    return Response.json(
      {
        success: false,
        error: { code: "ERROR", message: "common.error.forbidden" },
      },
      { status: 403 },
    );
  }

  const { body, error } = await parseBody(req);
  if (error) return error;

  const data = body.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return Response.json(
      {
        success: false,
        error: {
          code: "VALIDATION",
          errors: ["validation.field.required"],
        },
      },
      { status: 400 },
    );
  }

  const tenant = csTenant(ctx);

  // Check if a row already exists for this tenant scope
  const existing = await genericList<TenantData>({
    table: "tenant_data",
    select: "id",
    tenant,
    limit: 1,
  });

  let result;
  if (existing.items[0]) {
    result = await genericUpdate<TenantData>(
      {
        table: "tenant_data",
        tenant,
        fields: [{ field: "data" }],
      },
      existing.items[0].id,
      { data },
    );
  } else {
    result = await genericCreate<TenantData>(
      {
        table: "tenant_data",
        tenant,
        allowCreateCallerTenant: true,
        fields: [{ field: "data" }],
      },
      { data },
    );
  }

  if (!result.success) {
    return Response.json(
      {
        success: false,
        error: { code: "ERROR", message: "common.error.generic" },
      },
      { status: 500 },
    );
  }

  revalidateTenantCache(
    {
      systemId: ctx.tenantContext.tenant.systemId,
      companyId: ctx.tenantContext.tenant.companyId,
    },
    "tenant-data",
  );

  return Response.json({ success: true, data: result.data });
}

async function deleteHandler(req: Request, ctx: RequestContext) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";

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
    { table: "tenant_data", tenant: ctx.tenantContext.tenant },
    id,
  );

  if (
    ctx.tenantContext.tenant.companyId &&
    ctx.tenantContext.tenant.systemId
  ) {
    revalidateTenantCache(
      {
        systemId: ctx.tenantContext.tenant.systemId,
        companyId: ctx.tenantContext.tenant.companyId,
      },
      "tenant-data",
    );
  }

  return Response.json({ success: true });
}

export const GET = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 60 },
  }),
  async (req, ctx) => getHandler(req, ctx),
);

export const PUT = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 60 },
  }),
  async (req, ctx) => putHandler(req, ctx),
);

export const DELETE = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 60 },
  }),
  async (req, ctx) => deleteHandler(req, ctx),
);
