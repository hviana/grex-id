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
import type { System } from "@/src/contracts/system";
import { rid } from "@/server/db/connection";
import Core from "@/server/utils/Core";

async function getHandler(req: Request, ctx: RequestContext) {
  const url = new URL(req.url);
  const search = url.searchParams.get("search") ?? undefined;
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const limit = Number(url.searchParams.get("limit") ?? "20");
  const companyId = url.searchParams.get("companyId") ?? undefined;
  const isSuperuser = ctx.tenant.roles.includes("superuser");

  const extraConditions: string[] = [];
  const extraBindings: Record<string, unknown> = {};

  // Non-superusers only see their own system.
  if (!isSuperuser && ctx.tenant.systemId) {
    extraConditions.push("id = $autoSystemId");
    extraBindings.autoSystemId = rid(ctx.tenant.systemId);
  }

  if (companyId) {
    extraConditions.push(
      "id IN (SELECT VALUE systemId FROM tenant WHERE companyId = $filterCompanyId AND systemId != NONE)",
    );
    extraBindings.filterCompanyId = rid(companyId);
  }

  const result = await genericList<System>(
    {
      table: "system",
      searchFields: ["name"],
      extraConditions: extraConditions.length > 0 ? extraConditions : undefined,
      extraBindings: Object.keys(extraBindings).length > 0
        ? extraBindings
        : undefined,
    },
    { search, cursor, limit },
  );
  return Response.json({ success: true, ...result });
}

async function postHandler(req: Request, _ctx: RequestContext) {
  const body = await req.json();
  const { name, slug, logoUri, defaultLocale, termsOfService } = body;

  const result = await genericCreate<System>(
    {
      table: "system",
      fields: [
        { field: "name", unique: true },
        { field: "slug", unique: true },
        { field: "logoUri" },
        { field: "defaultLocale" },
        { field: "termsOfService" },
      ],
    },
    {
      name,
      slug,
      logoUri: logoUri ?? "",
      defaultLocale: defaultLocale || undefined,
      termsOfService: termsOfService || undefined,
    },
  );

  if (!result.success) {
    if (result.errors) {
      return Response.json(
        {
          success: false,
          error: {
            code: "VALIDATION",
            errors: result.errors.flatMap((e) => e.errors),
          },
        },
        { status: 400 },
      );
    }
    if (result.duplicateFields) {
      return Response.json(
        {
          success: false,
          error: {
            code: "VALIDATION",
            errors: result.duplicateFields.map(
              (f) => `validation.${f}.duplicate`,
            ),
          },
        },
        { status: 409 },
      );
    }
  }

  await Core.getInstance().reload();

  return Response.json({ success: true, data: result.data }, { status: 201 });
}

async function putHandler(req: Request, _ctx: RequestContext) {
  const body = await req.json();
  const { id, name, slug, logoUri, defaultLocale, termsOfService } = body;

  if (!id) {
    return Response.json(
      {
        success: false,
        error: { code: "VALIDATION", errors: ["validation.id.required"] },
      },
      { status: 400 },
    );
  }

  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = name;
  if (slug !== undefined) data.slug = slug;
  if (logoUri !== undefined) data.logoUri = logoUri;
  if (defaultLocale !== undefined) data.defaultLocale = defaultLocale;
  if (termsOfService !== undefined) data.termsOfService = termsOfService;

  const result = await genericUpdate<System>(
    {
      table: "system",
      fields: [
        { field: "name", unique: true },
        { field: "slug", unique: true },
        { field: "logoUri" },
        { field: "defaultLocale" },
        { field: "termsOfService" },
      ],
    },
    id,
    data,
  );

  if (!result.success) {
    if (result.errors) {
      return Response.json(
        {
          success: false,
          error: {
            code: "VALIDATION",
            errors: result.errors.flatMap((e) => e.errors),
          },
        },
        { status: 400 },
      );
    }
    if (result.duplicateFields) {
      return Response.json(
        {
          success: false,
          error: {
            code: "VALIDATION",
            errors: result.duplicateFields.map(
              (f) => `validation.${f}.duplicate`,
            ),
          },
        },
        { status: 409 },
      );
    }
  }

  await Core.getInstance().reload();

  return Response.json({ success: true, data: result.data });
}

async function deleteHandler(req: Request, _ctx: RequestContext) {
  const body = await req.json();
  const { id } = body;

  if (!id) {
    return Response.json(
      {
        success: false,
        error: { code: "VALIDATION", errors: ["validation.id.required"] },
      },
      { status: 400 },
    );
  }

  await genericDelete({ table: "system" }, id);

  await Core.getInstance().reload();

  return Response.json({ success: true });
}

export const GET = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 100 }),
  withAuth({ requireAuthenticated: true }),
  getHandler,
);

export const POST = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 100 }),
  withAuth({ requireAuthenticated: true, roles: ["superuser"] }),
  postHandler,
);

export const PUT = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 100 }),
  withAuth({ requireAuthenticated: true, roles: ["superuser"] }),
  putHandler,
);

export const DELETE = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 100 }),
  withAuth({ requireAuthenticated: true, roles: ["superuser"] }),
  deleteHandler,
);
