import { compose } from "@/server/middleware/compose";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import { withAuth } from "@/server/middleware/withAuth";
import type { RequestContext } from "@/src/contracts/auth";
import Core from "@/server/utils/Core";
import { standardizeField } from "@/server/utils/field-standardizer";
import { createTenantToken } from "@/server/utils/token";
import { rememberActor } from "@/server/utils/actor-validity";
import {
  findSystemIdBySlug,
  resolveUserExchange,
} from "@/server/db/queries/auth";
import { createConnectedAppWithToken } from "@/server/db/queries/connected-apps";
import type { Tenant } from "@/src/contracts/tenant";

function withAuthRateLimit() {
  return async (
    req: Request,
    ctx: RequestContext,
    next: () => Promise<Response>,
  ): Promise<Response> => {
    const core = Core.getInstance();
    const rateLimitPerMinute = Number(
      (await core.getSetting("auth.rateLimit.perMinute")) || 5,
    );
    return withRateLimit({
      windowMs: 60_000,
      maxRequests: rateLimitPerMinute,
    })(req, ctx, next);
  };
}

/**
 * POST /api/auth/oauth/authorize
 *
 * Called by the OAuth authorize page after the user approves access.
 * Creates a connected_app + its backing api_token in a single batched
 * query, then returns the JWT (§8.1) the client will use as the bearer.
 */
async function handler(req: Request, ctx: RequestContext): Promise<Response> {
  if (!ctx.tenant.actorId) {
    return Response.json(
      {
        success: false,
        error: { code: "UNAUTHORIZED", message: "auth.error.unauthorized" },
      },
      { status: 401 },
    );
  }

  const body = await req.json();
  const {
    clientName,
    roles: requestedRoles,
    systemSlug,
    companyId,
    redirectOrigin,
    monthlySpendLimit,
    maxOperationCount,
  } = body;

  if (!clientName || !systemSlug || !companyId) {
    return Response.json(
      {
        success: false,
        error: {
          code: "VALIDATION",
          message: "validation.oauth.requiredFields",
        },
      },
      { status: 400 },
    );
  }

  const systemId = await findSystemIdBySlug(
    await standardizeField("slug", systemSlug),
  );
  if (!systemId) {
    return Response.json(
      {
        success: false,
        error: { code: "NOT_FOUND", message: "common.error.notFound" },
      },
      { status: 404 },
    );
  }

  const grantedRoles: string[] = typeof requestedRoles === "string"
    ? requestedRoles.split(",").map((r: string) => r.trim()).filter(Boolean)
    : Array.isArray(requestedRoles)
    ? requestedRoles
    : [];

  const userId = ctx.tenant.actorId;

  // Resolve the tenant row for this (user, company, system) combination.
  // The user must already be a member of this tenant to authorize a
  // connected app on its behalf.
  const resolved = await resolveUserExchange(userId, companyId, systemId);
  if (!resolved.tenantId) {
    return Response.json(
      {
        success: false,
        error: { code: "FORBIDDEN", message: "auth.error.notMemberOfTenant" },
      },
      { status: 403 },
    );
  }

  const resolvedSlug = await standardizeField("slug", systemSlug);
  const tokenTenant: Tenant = {
    id: resolved.tenantId,
    systemId: String(systemId),
    companyId: String(companyId),
    systemSlug: resolvedSlug,
    roles: grantedRoles,
  };

  const { app, token: createdToken } = await createConnectedAppWithToken({
    name: clientName,
    tenantId: resolved.tenantId,
    tenant: tokenTenant,
    roles: grantedRoles,
    monthlySpendLimit: monthlySpendLimit
      ? Number(monthlySpendLimit)
      : undefined,
    maxOperationCount: maxOperationCount ?? undefined,
    description: redirectOrigin ?? "",
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

  const farFuture = new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000);
  const jwt = await createTenantToken(
    {
      ...tokenTenant,
      actorType: "connected_app",
      actorId: String(createdToken.id),
      exchangeable: false,
      frontendUse: false,
      frontendDomains: [],
    },
    false,
    farFuture,
  );

  await rememberActor(resolved.tenantId, String(createdToken.id));

  return Response.json(
    { success: true, data: { token: jwt, app } },
    { status: 201 },
  );
}

export const POST = compose(
  withAuthRateLimit(),
  withAuth({ requireAuthenticated: true }),
  handler,
);
