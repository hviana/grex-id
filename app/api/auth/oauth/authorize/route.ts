import { compose } from "@/server/middleware/compose";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import { withAuth } from "@/server/middleware/withAuth";
import type { RequestContext } from "@/src/contracts/auth";
import Core from "@/server/utils/Core";
import { getDb, rid } from "@/server/db/connection";
import { createTenantToken } from "@/server/utils/token";
import { standardizeField } from "@/server/utils/field-standardizer";
import { rememberActor } from "@/server/utils/actor-validity";
import type { ApiToken } from "@/src/contracts/token";
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
 * query, then returns the JWT (§19.10) the client will use as the bearer.
 */
async function handler(req: Request, ctx: RequestContext): Promise<Response> {
  const claims = ctx.claims;
  if (!claims) {
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
    permissions,
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

  const db = await getDb();

  const sysResult = await db.query<[{ id: string }[]]>(
    "SELECT id FROM system WHERE slug = $slug LIMIT 1",
    { slug: standardizeField("slug", systemSlug) },
  );
  const systemId = sysResult[0]?.[0]?.id;
  if (!systemId) {
    return Response.json(
      {
        success: false,
        error: { code: "NOT_FOUND", message: "common.error.notFound" },
      },
      { status: 404 },
    );
  }

  const grantedPermissions: string[] = typeof permissions === "string"
    ? permissions.split(",").map((p: string) => p.trim()).filter(Boolean)
    : Array.isArray(permissions)
    ? permissions
    : [];

  const userId = claims.actorId;

  const resolvedSlug = standardizeField("slug", systemSlug);
  const tokenTenant: Tenant = {
    systemId: String(systemId),
    companyId: String(companyId),
    systemSlug: resolvedSlug,
    roles: [],
    permissions: grantedPermissions,
  };

  // Single batched query (§7.2): create api_token + connected_app and
  // return the fully-resolved rows.
  const result = await db.query<
    [unknown, unknown, ApiToken[], Record<string, unknown>[]]
  >(
    `LET $token = CREATE api_token SET
       userId = $userId,
       companyId = $companyId,
       systemId = $systemId,
       tenant = $tenant,
       name = $clientName,
       description = $redirectOrigin,
       permissions = $permissions,
       monthlySpendLimit = $monthlySpendLimit,
       maxOperationCount = $maxOperationCount,
       neverExpires = true,
       frontendUse = false,
       frontendDomains = [];
     LET $app = CREATE connected_app SET
       name = $clientName,
       companyId = $companyId,
       systemId = $systemId,
       permissions = $permissions,
       monthlySpendLimit = $monthlySpendLimit,
       maxOperationCount = $maxOperationCount,
       apiTokenId = $token[0].id;
     SELECT * FROM $token[0].id;
     SELECT * FROM $app[0].id;`,
    {
      clientName,
      companyId: rid(String(companyId)),
      systemId: rid(String(systemId)),
      tenant: tokenTenant,
      permissions: grantedPermissions,
      monthlySpendLimit: monthlySpendLimit
        ? Number(monthlySpendLimit)
        : undefined,
      maxOperationCount: maxOperationCount ?? undefined,
      userId: rid(userId),
      redirectOrigin: redirectOrigin ?? "",
    },
  );

  const createdToken = result[2]?.[0];
  const app = result[3]?.[0];
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

  await rememberActor(tokenTenant, String(createdToken.id));

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
