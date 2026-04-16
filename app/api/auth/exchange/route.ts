import { compose } from "@/server/middleware/compose";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import { withAuth } from "@/server/middleware/withAuth";
import type { RequestContext } from "@/src/contracts/auth";
import Core from "@/server/utils/Core";
import { createTenantToken, verifyTenantToken } from "@/server/utils/token";
import { isJtiRevoked, revokeJti } from "@/server/utils/token-revocation";
import { getDb, rid } from "@/server/db/connection";

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

  // Only user tokens can be exchanged
  if (claims.actorType !== "user" || !claims.exchangeable) {
    return Response.json(
      {
        success: false,
        error: { code: "FORBIDDEN", message: "auth.error.exchangeNotAllowed" },
      },
      { status: 403 },
    );
  }

  // Check current token not revoked
  if (claims.jti && (await isJtiRevoked(claims.jti))) {
    return Response.json(
      {
        success: false,
        error: { code: "UNAUTHORIZED", message: "auth.error.tokenRevoked" },
      },
      { status: 401 },
    );
  }

  const body = await req.json();
  const { companyId, systemId } = body;

  if (!companyId || !systemId) {
    return Response.json(
      {
        success: false,
        error: {
          code: "VALIDATION",
          message: "validation.exchange.companyAndSystem",
        },
      },
      { status: 400 },
    );
  }

  const db = await getDb();

  // Batch: verify membership + resolve system slug + resolve role permissions in one call
  const result = await db.query<
    [
      { id: string; roles: string[] }[],
      { slug: string }[],
      { permissions: string[] }[],
    ]
  >(
    `SELECT id, roles FROM user_company_system
       WHERE userId = $userId AND companyId = $companyId AND systemId = $systemId
       LIMIT 1;
     SELECT slug FROM system WHERE id = $systemId LIMIT 1;
     SELECT permissions FROM role WHERE id IN (SELECT VALUE roles FROM user_company_system
       WHERE userId = $userId AND companyId = $companyId AND systemId = $systemId LIMIT 1);`,
    {
      userId: rid(claims.actorId),
      companyId: rid(companyId),
      systemId: rid(systemId),
    },
  );

  if (!result[0] || result[0].length === 0) {
    return Response.json(
      {
        success: false,
        error: { code: "FORBIDDEN", message: "auth.error.notMemberOfTenant" },
      },
      { status: 403 },
    );
  }

  const userRoles = result[0][0].roles ?? [];
  const systemSlug = result[1]?.[0]?.slug ?? "core";
  const permissions = [
    ...new Set(result[2]?.flatMap((r) => r.permissions ?? []) ?? []),
  ];

  // Revoke old token
  const newJti = crypto.randomUUID();
  await revokeJti(claims.jti, "exchanged");

  const newToken = await createTenantToken(
    {
      systemId,
      companyId,
      systemSlug,
      roles: userRoles,
      permissions,
      actorType: "user",
      actorId: claims.actorId,
      jti: newJti,
      exchangeable: true,
    },
    false,
  );

  return Response.json({
    success: true,
    data: {
      systemToken: newToken,
      tenant: {
        systemId,
        companyId,
        systemSlug,
        roles: userRoles,
        permissions,
      },
    },
  });
}

// Exchange uses withAuth since it requires authentication
export const POST = compose(
  withAuthRateLimit(),
  withAuth({ requireAuthenticated: true }),
  handler,
);
