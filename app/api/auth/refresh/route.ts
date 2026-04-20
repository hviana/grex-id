import { compose } from "@/server/middleware/compose";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import Core from "@/server/utils/Core";
import { createTenantToken, verifyTenantToken } from "@/server/utils/token";
import { isJtiRevoked } from "@/server/utils/token-revocation";
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
  const body = await req.json();
  const { systemToken } = body;

  if (!systemToken) {
    return Response.json(
      {
        success: false,
        error: { code: "VALIDATION", message: "validation.token.required" },
      },
      { status: 400 },
    );
  }

  try {
    const claims = await verifyTenantToken(systemToken);

    // Check if token has been revoked
    if (claims.jti && (await isJtiRevoked(claims.jti))) {
      return Response.json(
        {
          success: false,
          error: { code: "UNAUTHORIZED", message: "auth.error.tokenRevoked" },
        },
        { status: 401 },
      );
    }

    const db = await getDb();

    // Always fetch user first
    const userResult = await db.query<
      [{ id: string; email: string; stayLoggedIn: boolean; roles: string[] }[]]
    >(
      `SELECT id, email, stayLoggedIn, roles FROM user WHERE id = $userId LIMIT 1;`,
      { userId: rid(claims.actorId) },
    );

    const user = userResult[0]?.[0];
    if (!user) {
      return Response.json(
        {
          success: false,
          error: { code: "USER_NOT_FOUND", message: "auth.error.userNotFound" },
        },
        { status: 401 },
      );
    }

    // Resolve updated claims
    let updatedClaims = claims;
    if (claims.actorType === "user") {
      const isSuperuser = (user.roles ?? []).includes("superuser");

      if (isSuperuser) {
        updatedClaims = { ...claims, roles: ["superuser"], permissions: ["*"] };
      } else if (claims.systemId !== "0" && claims.companyId !== "0") {
        const membershipResult = await db.query<
          [{ roles: string[] }[], { permissions: string[] }[]]
        >(
          `SELECT roles FROM user_company_system
             WHERE userId = $userId AND companyId = $companyId AND systemId = $systemId
             LIMIT 1;
           SELECT permissions FROM role WHERE systemId = $systemId AND id IN (SELECT VALUE roles FROM user_company_system
             WHERE userId = $userId AND companyId = $companyId AND systemId = $systemId LIMIT 1);`,
          {
            userId: rid(claims.actorId),
            companyId: rid(claims.companyId),
            systemId: rid(claims.systemId),
          },
        );
        const roles = membershipResult[0]?.[0]?.roles ?? claims.roles;
        const permissions = [
          ...new Set(membershipResult[1]?.flatMap((r) => r.permissions ?? []) ?? []),
        ];
        updatedClaims = { ...claims, roles, permissions };
      }
    }

    // Issue new token with same tenant but fresh expiry
    const newJti = crypto.randomUUID();
    const newToken = await createTenantToken(
      { ...updatedClaims, jti: newJti },
      user.stayLoggedIn ?? false,
    );

    return Response.json({
      success: true,
      data: {
        systemToken: newToken,
      },
    });
  } catch {
    return Response.json(
      {
        success: false,
        error: { code: "INVALID_TOKEN", message: "auth.error.invalidToken" },
      },
      { status: 401 },
    );
  }
}

export const POST = compose(withAuthRateLimit(), handler);
