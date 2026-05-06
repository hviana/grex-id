import { compose } from "@/server/middleware/compose";
import { withAuthAndLimit } from "@/server/middleware/withAuthAndLimit";
import type { RequestContext } from "@/src/contracts/high-level/tenant-context";
import { createTenantToken } from "@/server/utils/token";
import { forgetActor, rememberActor } from "@/server/utils/actor-validity";
import { genericCreate, genericGetById } from "@/server/db/queries/generics";
import { ensureCompanySystemTenant } from "@/server/db/queries/billing";
import { getTokensForTenant, revokeToken } from "@/server/db/queries/tokens";
import { rid } from "@/server/db/connection";
import type { ApiToken } from "@/src/contracts/api-token";
import { parseBody } from "@/server/utils/parse-body";

async function getHandler(req: Request, ctx: RequestContext) {
  const url = new URL(req.url);
  const actorType = url.searchParams.get("actorType") ?? undefined;

  if (ctx.tenantContext.tenant.companyId && ctx.tenantContext.tenant.systemId) {
    const result = await getTokensForTenant({
      companyId: ctx.tenantContext.tenant.companyId,
      systemId: ctx.tenantContext.tenant.systemId,
      actorType,
      limit: 50,
    });
    return Response.json({ success: true, ...result });
  }

  return Response.json({ success: true, items: [] });
}

async function postHandler(req: Request, ctx: RequestContext) {
  const { body, error } = await parseBody(req);
  if (error) return error;
  const {
    name,
    description,
    actorType,
    resourceLimits,
    neverExpires,
    expiresAt,
    frontendUse,
    frontendDomains,
  } = body;

  if (!name) {
    return Response.json(
      {
        success: false,
        error: {
          code: "VALIDATION",
          message: "validation.token.requiredFields",
        },
      },
      { status: 400 },
    );
  }

  const at = actorType === "app" ? "app" : "token";

  if (neverExpires && expiresAt) {
    return Response.json(
      {
        success: false,
        error: {
          code: "VALIDATION",
          message: "validation.token.expiryExclusive",
        },
      },
      { status: 400 },
    );
  }

  const rlDomains: string[] = (resourceLimits?.frontendDomains as string[]) ??
    frontendDomains ??
    [];
  const useFrontend = frontendUse === true || rlDomains.length > 0;

  if (useFrontend && rlDomains.length === 0) {
    return Response.json(
      {
        success: false,
        error: {
          code: "VALIDATION",
          message: "validation.token.frontendDomainsRequired",
        },
      },
      { status: 400 },
    );
  }

  // Resolve the company-system tenant for api_token scoping.
  const csTenantId = await ensureCompanySystemTenant({
    companyId: ctx.tenantContext.tenant.companyId!,
    systemId: ctx.tenantContext.tenant.systemId!,
  });

  const limitsData: Record<string, unknown> = { ...(resourceLimits ?? {}) };
  if (Array.isArray(limitsData.roleIds) && limitsData.roleIds.length > 0) {
    limitsData.roleIds = (limitsData.roleIds as string[]).map((id: string) =>
      rid(id)
    );
  }

  const rlFields = Object.keys(limitsData).map((field) => ({ field }));

  const apiTokenData: Record<string, unknown> = {
    name,
    description: description ?? "",
    actorType: at,
    neverExpires: neverExpires === true || (!neverExpires && !expiresAt),
  };
  if (expiresAt) {
    apiTokenData.expiresAt = new Date(expiresAt);
  }

  const createResult = await genericCreate<ApiToken>(
    {
      table: "api_token",
      tenant: { id: csTenantId },
      fields: [
        { field: "name" },
        { field: "description" },
        { field: "actorType" },
        { field: "neverExpires" },
        { field: "expiresAt" },
      ],
      cascade: [
        {
          table: "resource_limit",
          sourceField: "resourceLimitId",
        },
      ],
      cascadeData: rlFields.length > 0
        ? [{ table: "resource_limit", fields: rlFields, rows: [limitsData] }]
        : undefined,
      allowCreateCallerTenant: true,
    },
    apiTokenData,
  );
  if (!createResult.success || !createResult.data) {
    return Response.json(
      {
        success: false,
        error: {
          code: "VALIDATION",
          errors: createResult.errors?.map((e: { errors: string[] }) =>
            e.errors
          ).flat() ?? [
            "common.error.generic",
          ],
        },
      },
      { status: 500 },
    );
  }

  const createdToken = createResult.data;

  const far = new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000);
  const exp = createdToken.neverExpires
    ? far
    : createdToken.expiresAt
    ? new Date(createdToken.expiresAt)
    : far;

  const jwt = await createTenantToken(
    {
      id: csTenantId,
      systemId: ctx.tenantContext.tenant.systemId,
      companyId: ctx.tenantContext.tenant.companyId,
      actorId: String(createdToken.id),
    },
    false,
    exp,
  );

  await rememberActor({
    id: csTenantId,
    actorId: String(createdToken.id),
  });

  return Response.json(
    { success: true, data: { token: jwt } },
    { status: 201 },
  );
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

  // Fetch the token to discover its tenantId for actor-validity invalidation.
  const token = await genericGetById<{ tenantIds?: string[] }>({
    table: "api_token",
    select: "tenantIds",
    tenant: {
      companyId: ctx.tenantContext.tenant.companyId,
      systemId: ctx.tenantContext.tenant.systemId,
    },
  }, id);

  const rawTenantIds = token?.tenantIds;
  const tenantId = rawTenantIds instanceof Set
    ? ([...rawTenantIds][0] as string | undefined)
    : Array.isArray(rawTenantIds)
    ? rawTenantIds[0]
    : undefined;

  await revokeToken(id);

  if (tenantId) {
    await forgetActor({ id: String(tenantId), actorId: id });
  }

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
