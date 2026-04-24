import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import {
  genericCreate,
  genericDelete,
  genericList,
  genericUpdate,
} from "@/server/db/queries/generics";
import type { Tag } from "@/src/contracts/tag";

async function getHandler(req: Request, ctx: RequestContext) {
  const url = new URL(req.url);
  const search = url.searchParams.get("search");
  const { companyId, systemId } = ctx.tenant;

  if (companyId === "0" || systemId === "0") {
    return Response.json({ success: true, data: [] });
  }

  const result = await genericList<Tag>(
    {
      table: "tag",
      searchFields: ["name"],
      ...(search ? {} : { orderBy: "name ASC" }),
    },
    {
      search: search ?? undefined,
      limit: search ? 20 : 200,
      ensureTenant: { companyId, systemId },
    },
  );

  return Response.json({ success: true, data: result.data });
}

async function postHandler(req: Request, ctx: RequestContext) {
  const body = await req.json();
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
      ensureTenant: {
        companyId: ctx.tenant.companyId,
        systemId: ctx.tenant.systemId,
      },
      fields: [{ field: "name", unique: true, entity: "tag" }],
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

async function putHandler(req: Request, _ctx: RequestContext) {
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
      fields: name ? [{ field: "name", unique: true, entity: "tag" }] : [],
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

async function deleteHandler(req: Request, _ctx: RequestContext) {
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

  await genericDelete({ table: "tag" }, id);
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

export const PUT = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 60 }),
  withAuth({ requireAuthenticated: true }),
  async (req, ctx) => putHandler(req, ctx),
);

export const DELETE = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 60 }),
  withAuth({ requireAuthenticated: true }),
  async (req, ctx) => deleteHandler(req, ctx),
);
