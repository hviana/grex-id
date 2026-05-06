import { compose } from "@/server/middleware/compose";
import { withAuthAndLimit } from "@/server/middleware/withAuthAndLimit";

import type { RequestContext } from "@/src/contracts/high-level/tenant-context";
import {
  genericCreate,
  genericDelete,
  genericList,
  genericUpdate,
} from "@/server/db/queries/generics";
import type { Tag } from "@/src/contracts/tag";
import { parseBody } from "@/server/utils/parse-body";
import { csTenant } from "@/server/utils/cs-tenant";

async function getHandler(req: Request, ctx: RequestContext) {
  const url = new URL(req.url);
  const search = url.searchParams.get("search");

  if (
    !ctx.tenantContext.tenant.companyId || !ctx.tenantContext.tenant.systemId
  ) {
    return Response.json({
      success: true,
      items: [],
      total: 0,
      hasMore: false,
    });
  }

  const result = await genericList<Tag>({
    table: "tag",
    select: "id, name, tenantIds, createdAt, updatedAt",
    searchFields: ["name"],
    ...(search ? {} : { orderBy: "name" }),
    search: search ?? undefined,
    limit: search ? 20 : 200,
    tenant: csTenant(ctx),
  });

  return Response.json({ success: true, ...result });
}

async function postHandler(req: Request, ctx: RequestContext) {
  const { body, error } = await parseBody(req);
  if (error) return error;
  const name = body.name?.trim();
  const color = body.color?.trim() ?? "";

  if (!name) {
    return Response.json(
      {
        success: false,
        error: {
          code: "VALIDATION",
          errors: ["validation.name.required"],
        },
      },
      { status: 400 },
    );
  }

  if (!color || !/^#[0-9a-fA-F]{6}$/.test(color)) {
    return Response.json(
      {
        success: false,
        error: {
          code: "VALIDATION",
          errors: ["validation.color.invalid"],
        },
      },
      { status: 400 },
    );
  }

  const result = await genericCreate<Tag>(
    {
      table: "tag",
      tenant: csTenant(ctx),
      allowCreateCallerTenant: true,
      fields: [{ field: "name", unique: true, entity: "tag" }, {
        field: "color",
      }],
    },
    { name, color },
  );

  if (!result.success) {
    if (result.duplicateFields?.length) {
      return Response.json(
        {
          success: false,
          error: { code: "DUPLICATE", message: "validation.tag.duplicate" },
        },
        { status: 409 },
      );
    }
    return Response.json(
      {
        success: false,
        error: {
          code: "VALIDATION",
          errors: result.errors?.flatMap((e) => e.errors) ?? [],
        },
      },
      { status: 400 },
    );
  }

  return Response.json({ success: true, data: result.data }, { status: 201 });
}

async function putHandler(req: Request, ctx: RequestContext) {
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

  const name = body.name?.trim();
  const color = body.color?.trim();

  if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) {
    return Response.json(
      {
        success: false,
        error: {
          code: "VALIDATION",
          errors: ["validation.color.invalid"],
        },
      },
      { status: 400 },
    );
  }

  const updates: Record<string, string> = {};
  if (name !== undefined) updates.name = name;
  if (color !== undefined) updates.color = color;

  if (Object.keys(updates).length === 0) {
    return Response.json({ success: true, data: null });
  }

  const result = await genericUpdate<Tag>(
    {
      table: "tag",
      tenant: csTenant(ctx),
      fields: name
        ? [{ field: "name", unique: true, entity: "tag" }, { field: "color" }]
        : [{ field: "color" }],
    },
    id,
    updates,
  );

  if (!result.success) {
    if (result.duplicateFields?.length) {
      return Response.json(
        {
          success: false,
          error: { code: "DUPLICATE", message: "validation.tag.duplicate" },
        },
        { status: 409 },
      );
    }
    return Response.json(
      {
        success: false,
        error: { code: "ERROR", message: "common.error.generic" },
      },
      { status: 500 },
    );
  }

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

  await genericDelete({ table: "tag", tenant: ctx.tenantContext.tenant }, id);
  return Response.json({ success: true });
}

export const GET = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 60 },
  }),
  async (req, ctx) => getHandler(req, ctx),
);

export const POST = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 60 },
  }),
  async (req, ctx) => postHandler(req, ctx),
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
