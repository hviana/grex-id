import { compose } from "@/server/middleware/compose";
import { withAuthAndLimit } from "@/server/middleware/withAuthAndLimit";
import type { RequestContext } from "@/src/contracts/high-level/tenant-context";
import { createTenantToken } from "@/server/utils/token";
import { forgetActor, rememberActor } from "@/server/utils/actor-validity";
import {
  createTokenWithResourceLimit,
  revokeToken,
} from "@/server/db/queries/tokens";
import { genericList } from "@/server/db/queries/generics";
import type { ApiToken } from "@/src/contracts/api-token";

async function getHandler(req: Request, ctx: RequestContext) {
  const url = new URL(req.url);
  const actorType = url.searchParams.get("actorType") ?? undefined;

  const extraConditions: string[] = ["revokedAt IS NONE"];
  if (actorType) {
    extraConditions.push(`actorType = "${actorType}"`);
  }

  const result = await genericList<ApiToken>({
    table: "api_token",
    select:
      "id, name, description, actorType, neverExpires, expiresAt, createdAt, resourceLimitId.* AS resourceLimitId",
    orderBy: "createdAt",
    orderByDirection: "DESC",
    extraConditions,
    limit: 50,
    tenant: ctx.tenantContext.tenant,
  });
  return Response.json({ success: true, data: result.items });
}

async function postHandler(req: Request, ctx: RequestContext) {
  const body = await req.json();
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

  const createdToken = await createTokenWithResourceLimit({
    name,
    description: description ?? undefined,
    actorType: at,
    tenantId: ctx.tenantContext.tenant.id!,
    resourceLimits: resourceLimits ?? undefined,
    neverExpires: neverExpires === true,
    expiresAt: expiresAt ? new Date(expiresAt + "T23:59:59.999Z") : undefined,
  });

  if (!createdToken) {
    return Response.json(
      {
        success: false,
        error: { code: "ERROR", message: "common.error.generic" },
      },
      { status: 500 },
    );
  }

  const far = new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000);
  const exp = createdToken.neverExpires
    ? far
    : createdToken.expiresAt
    ? new Date(createdToken.expiresAt)
    : far;

  const jwt = await createTenantToken(
    {
      id: ctx.tenantContext.tenant.id,
      systemId: ctx.tenantContext.tenant.systemId,
      companyId: ctx.tenantContext.tenant.companyId,
      actorId: String(createdToken.id),
    },
    false,
    exp,
  );

  await rememberActor({
    id: ctx.tenantContext.tenant.id!,
    actorId: String(createdToken.id),
  });

  return Response.json(
    { success: true, data: { token: jwt } },
    { status: 201 },
  );
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

  const row = await revokeToken(id);
  if (row) {
    await forgetActor({ id: row.tenantId, actorId: id });
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
