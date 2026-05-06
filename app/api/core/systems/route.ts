import { compose } from "@/server/middleware/compose";
import { withAuthAndLimit } from "@/server/middleware/withAuthAndLimit";
import type { RequestContext } from "@/src/contracts/high-level/tenant-context";
import {
  genericCreate,
  genericDelete,
  genericList,
  genericUpdate,
} from "@/server/db/queries/generics";
import type { System } from "@/src/contracts/system";
import { parseBody } from "@/server/utils/parse-body";
import { rid } from "@/server/db/connection";
import { updateTenantCache } from "@/server/utils/cache";

async function getHandler(req: Request, ctx: RequestContext) {
  const url = new URL(req.url);
  const search = url.searchParams.get("search") ?? undefined;
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const limit = Number(url.searchParams.get("limit") ?? "20");
  const companyId = url.searchParams.get("companyId") ?? undefined;

  const roles = ctx.tenantContext.roles;
  const isSuperuser = roles.includes("superuser");

  const extraConditions: string[] = [];
  const extraBindings: Record<string, unknown> = {};

  if (!isSuperuser && ctx.tenantContext.tenant.systemId) {
    extraConditions.push("id = $autoSystemId");
    extraBindings.autoSystemId = rid(ctx.tenantContext.tenant.systemId);
  }

  if (companyId) {
    extraConditions.push(
      "id IN (SELECT VALUE systemId FROM tenant WHERE companyId = $filterCompanyId AND systemId != NONE)",
    );
    extraBindings.filterCompanyId = rid(companyId);
  }

  const result = await genericList<System>({
    table: "system",
    searchFields: ["name"],
    extraConditions: extraConditions.length > 0 ? extraConditions : undefined,
    extraAccessFields: ["id"],
    allowRawExtraConditions: true,
    extraBindings: Object.keys(extraBindings).length > 0
      ? extraBindings
      : undefined,
    search,
    cursor,
    limit,
    allowSensitiveGlobalRead: true,
  });
  return Response.json({ success: true, ...result });
}

async function postHandler(req: Request, _ctx: RequestContext) {
  const { body, error } = await parseBody(req);
  if (error) return error;
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
      allowSensitiveGlobalMutation: true,
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

  updateTenantCache();

  return Response.json({ success: true, data: result.data }, { status: 201 });
}

async function putHandler(req: Request, _ctx: RequestContext) {
  const { body, error } = await parseBody(req);
  if (error) return error;
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
      allowSensitiveGlobalMutation: true,
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

  updateTenantCache();

  return Response.json({ success: true, data: result.data });
}

async function deleteHandler(req: Request, _ctx: RequestContext) {
  const { body, error } = await parseBody(req);
  if (error) return error;
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

  await genericDelete(
    { table: "system", allowSensitiveGlobalMutation: true },
    id,
  );

  updateTenantCache();

  return Response.json({ success: true });
}

export const GET = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 100 },
    requireAuthenticated: true,
  }),
  getHandler,
);

export const POST = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 100 },
    accesses: [{ roles: ["superuser"] }],
  }),
  postHandler,
);

export const PUT = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 100 },
    accesses: [{ roles: ["superuser"] }],
  }),
  putHandler,
);

export const DELETE = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 100 },
    accesses: [{ roles: ["superuser"] }],
  }),
  deleteHandler,
);
