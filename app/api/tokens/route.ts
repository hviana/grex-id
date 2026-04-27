import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import { createTenantToken } from "@/server/utils/token";
import { forgetActor, rememberActor } from "@/server/utils/actor-validity";
import {
  createTokenWithResourceLimit,
  revokeToken,
} from "@/server/db/queries/tokens";
import { genericList } from "@/server/db/queries/generics";
import type { ApiToken } from "@/src/contracts/token";

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
    tenant: ctx.tenant,
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

  // Resolve frontendUse/frontendDomains from resourceLimits or direct body
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
    tenantId: ctx.tenant.id,
    tenant: {
      id: ctx.tenant.id,
      systemId: ctx.tenant.systemId,
      companyId: ctx.tenant.companyId,
      systemSlug: ctx.tenant.systemSlug,
      roles: (resourceLimits?.roles as string[]) ?? [],
    },
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

  // Issue the JWT bearer for this api_token. The actor id is the row id
  // (§8.11); exp comes from expiresAt or a far-future date for
  // never-expires tokens.
  const far = new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000);
  const exp = createdToken.neverExpires
    ? far
    : createdToken.expiresAt
    ? new Date(createdToken.expiresAt)
    : far;

  const resLimits = createdToken.resourceLimitId;
  const roles = resLimits?.roles ?? [];
  const rlFrontendDomains = resLimits?.frontendDomains ?? [];

  const jwt = await createTenantToken(
    {
      id: ctx.tenant.id,
      systemId: ctx.tenant.systemId,
      companyId: ctx.tenant.companyId,
      systemSlug: ctx.tenant.systemSlug,
      roles,
      actorType: "api_token",
      actorId: String(createdToken.id),
      exchangeable: false,
      frontendUse: useFrontend,
      frontendDomains: rlFrontendDomains,
    },
    false,
    exp,
  );

  await rememberActor(ctx.tenant.id, String(createdToken.id));

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
    await forgetActor(row.tenantId, id);
  }

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
