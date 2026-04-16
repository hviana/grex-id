import { compose } from "@/server/middleware/compose";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import { withAuth } from "@/server/middleware/withAuth";
import type { RequestContext } from "@/src/contracts/auth";
import Core from "@/server/utils/Core";
import { getDb, rid } from "@/server/db/connection";
import { generateSecureToken, hashToken } from "@/server/utils/token";
import { standardizeField } from "@/server/utils/field-standardizer";

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
 * Creates a connected_app record and an api_token for the requesting app.
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

  // Resolve systemId from slug
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
  const rawToken = generateSecureToken();
  const tokenHash = await hashToken(rawToken);

  // Single batched query: create connected_app + api_token
  const result = await db.query<[unknown, unknown, Record<string, unknown>[]]>(
    `LET $app = CREATE connected_app SET
       name = $clientName,
       companyId = $companyId,
       systemId = $systemId,
       permissions = $permissions,
       monthlySpendLimit = $monthlySpendLimit;
     CREATE api_token SET
       userId = $userId,
       companyId = $companyId,
       systemId = $systemId,
       name = $clientName,
       description = $redirectOrigin,
       tokenHash = $tokenHash,
       permissions = $permissions,
       monthlySpendLimit = $monthlySpendLimit;
     SELECT * FROM $app[0].id;`,
    {
      clientName,
      companyId: rid(companyId),
      systemId: rid(systemId),
      permissions: grantedPermissions,
      monthlySpendLimit: monthlySpendLimit
        ? Number(monthlySpendLimit)
        : undefined,
      userId: rid(userId),
      redirectOrigin: redirectOrigin ?? "",
      tokenHash,
    },
  );

  const app = result[2]?.[0];

  return Response.json(
    { success: true, data: { token: rawToken, app } },
    { status: 201 },
  );
}

export const POST = compose(
  withAuthRateLimit(),
  withAuth({ requireAuthenticated: true }),
  handler,
);
