import { compose } from "@/server/middleware/compose";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import { withAuth } from "@/server/middleware/withAuth";
import type { RequestContext } from "@/src/contracts/auth";
import Core from "@/server/utils/Core";
import { createTenantToken } from "@/server/utils/token";
import { forgetActor, rememberActor } from "@/server/utils/actor-validity";
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

  // Only user tokens can be exchanged (§19.11)
  if (claims.actorType !== "user" || !claims.exchangeable) {
    return Response.json(
      {
        success: false,
        error: { code: "FORBIDDEN", message: "auth.error.exchangeNotAllowed" },
      },
      { status: 403 },
    );
  }

  // Note: withAuth has already validated the current token against the
  // actor-validity cache (§12.8). No additional revocation check here.

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
  const oldTenant = {
    companyId: String(claims.companyId),
    systemId: String(claims.systemId),
  };

  // Superuser company-access bypass (§19.11.1)
  const isSuperuser = claims.roles.includes("superuser");

  if (isSuperuser) {
    // Verify company_system association exists and resolve slug
    const suResult = await db.query<
      [{ id: string }[], { slug: string }[]]
    >(
      `SELECT id FROM company_system
         WHERE companyId = $companyId AND systemId = $systemId LIMIT 1;
       SELECT slug FROM system WHERE id = $systemId LIMIT 1;`,
      {
        companyId: rid(companyId),
        systemId: rid(systemId),
      },
    );

    if (!suResult[0] || suResult[0].length === 0) {
      return Response.json(
        {
          success: false,
          error: { code: "FORBIDDEN", message: "auth.error.notMemberOfTenant" },
        },
        { status: 403 },
      );
    }

    const systemSlug = suResult[1]?.[0]?.slug ?? "core";
    const oldExp = claims.exp ? new Date(claims.exp * 1000) : undefined;

    const newToken = await createTenantToken(
      {
        systemId,
        companyId,
        systemSlug,
        roles: ["admin"],
        permissions: ["*"],
        actorType: "user",
        actorId: claims.actorId,
        exchangeable: true,
      },
      false,
      oldExp,
    );

    // Move the user id from the old tenant's partition to the new one
    // (§12.8, §19.11 step 6).
    const newTenant = {
      companyId: String(companyId),
      systemId: String(systemId),
    };
    await forgetActor(oldTenant, String(claims.actorId));
    await rememberActor(newTenant, String(claims.actorId));

    return Response.json({
      success: true,
      data: {
        systemToken: newToken,
        tenant: {
          systemId,
          companyId,
          systemSlug,
          roles: ["admin"],
          permissions: ["*"],
        },
      },
    });
  }

  // Batch: verify membership + resolve slug/permissions — single query (§7.2, §19.11)
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

  // Carry over remaining lifetime from the old token (§19.11 step 6)
  const oldExp = claims.exp ? new Date(claims.exp * 1000) : undefined;

  const newToken = await createTenantToken(
    {
      systemId,
      companyId,
      systemSlug,
      roles: userRoles,
      permissions,
      actorType: "user",
      actorId: claims.actorId,
      exchangeable: true,
    },
    false,
    oldExp,
  );

  // Move the user id from the old tenant's partition to the new one
  // (§12.8, §19.11 step 6).
  const newTenant = {
    companyId: String(companyId),
    systemId: String(systemId),
  };
  await forgetActor(oldTenant, String(claims.actorId));
  await rememberActor(newTenant, String(claims.actorId));

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

export const POST = compose(
  withAuthRateLimit(),
  withAuth({ requireAuthenticated: true }),
  handler,
);
