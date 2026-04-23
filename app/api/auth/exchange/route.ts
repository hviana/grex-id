import { compose } from "@/server/middleware/compose";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import { withAuth } from "@/server/middleware/withAuth";
import type { RequestContext } from "@/src/contracts/auth";
import Core from "@/server/utils/Core";
import { createTenantToken } from "@/server/utils/token";
import { forgetActor, rememberActor } from "@/server/utils/actor-validity";
import {
  resolveSuperuserExchange,
  resolveUserExchange,
} from "@/server/db/queries/auth";

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

  const oldTenant = {
    companyId: String(claims.companyId),
    systemId: String(claims.systemId),
  };

  // Superuser company-access bypass (§19.11.1)
  const isSuperuser = claims.roles.includes("superuser");

  if (isSuperuser) {
    const suResult = await resolveSuperuserExchange(companyId, systemId);

    if (!suResult.exists) {
      return Response.json(
        {
          success: false,
          error: { code: "FORBIDDEN", message: "auth.error.notMemberOfTenant" },
        },
        { status: 403 },
      );
    }

    const systemSlug = suResult.slug;
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

  // Verify membership + resolve slug/permissions (§7.2, §19.11)
  const result = await resolveUserExchange(
    claims.actorId,
    companyId,
    systemId,
  );

  if (!result.membership) {
    return Response.json(
      {
        success: false,
        error: { code: "FORBIDDEN", message: "auth.error.notMemberOfTenant" },
      },
      { status: 403 },
    );
  }

  const userRoles = result.membership.roles ?? [];
  const systemSlug = result.slug;
  const permissions = result.permissions;

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
