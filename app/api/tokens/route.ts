import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import { createTenantToken } from "@/server/utils/token";
import { forgetActor, rememberActor } from "@/server/utils/actor-validity";
import {
  createApiToken,
  listTokensFiltered,
  revokeToken,
} from "@/server/db/queries/tokens";
import type { Tenant } from "@/src/contracts/tenant";

async function getHandler(req: Request, ctx: RequestContext) {
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId") || undefined;
  const companyId = ctx.tenant.companyId;

  const data = await listTokensFiltered({ userId, companyId });
  return Response.json({ success: true, data });
}

async function postHandler(req: Request, ctx: RequestContext) {
  const body = await req.json();
  const {
    name,
    description,
    userId,
    companyId,
    systemId,
    permissions,
    monthlySpendLimit,
    maxOperationCount,
    neverExpires,
    expiresAt,
    frontendUse,
    frontendDomains,
  } = body;

  if (!name || !userId || !companyId || !systemId) {
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

  const useFrontend = frontendUse === true;
  const domains: string[] = frontendDomains ?? [];
  if (useFrontend && domains.length === 0) {
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

  const tenant: Tenant = {
    systemId: ctx.tenant.systemId,
    companyId: ctx.tenant.companyId,
    systemSlug: ctx.tenant.systemSlug,
    roles: [],
    permissions: permissions ?? [],
  };

  const createdToken = await createApiToken({
    userId,
    companyId,
    systemId,
    tenant,
    name,
    description: description ?? undefined,
    permissions: permissions ?? [],
    monthlySpendLimit: monthlySpendLimit ?? undefined,
    maxOperationCount: maxOperationCount ?? undefined,
    neverExpires: neverExpires === true,
    expiresAt: expiresAt ? new Date(expiresAt + "T23:59:59.999Z") : undefined,
    frontendUse: useFrontend,
    frontendDomains: domains,
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

  const jwt = await createTenantToken(
    {
      ...tenant,
      actorType: "api_token",
      actorId: String(createdToken.id),
      exchangeable: false,
      frontendUse: createdToken.frontendUse,
      frontendDomains: createdToken.frontendDomains ?? [],
    },
    false,
    exp,
  );

  await rememberActor(tenant, String(createdToken.id));

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

  // Resolve tenant + revoke in a single batched query (§7.2).
  const row = await revokeToken(id);
  if (row) {
    await forgetActor(row, id);
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
