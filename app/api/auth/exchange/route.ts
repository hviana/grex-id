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
  if (!ctx.tenant.actorType) {
    return Response.json(
      {
        success: false,
        error: { code: "UNAUTHORIZED", message: "auth.error.unauthorized" },
      },
      { status: 401 },
    );
  }

  // Only user tokens can be exchanged (§8.6)
  if (ctx.tenant.actorType !== "user" || !ctx.tenant.exchangeable) {
    return Response.json(
      {
        success: false,
        error: { code: "FORBIDDEN", message: "auth.error.exchangeNotAllowed" },
      },
      { status: 403 },
    );
  }

  // Note: withAuth has already validated the current token against the
  // actor-validity cache (§8.11). No additional revocation check here.

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

  const oldTenantId = ctx.tenant.id;

  // Superuser company-access bypass (§8.6.1)
  const isSuperuser = ctx.tenant.roles.includes("superuser");

  if (isSuperuser) {
    const suResult = await resolveSuperuserExchange(companyId, systemId);

    if (!suResult.exists || !suResult.tenantId) {
      return Response.json(
        {
          success: false,
          error: { code: "FORBIDDEN", message: "auth.error.notMemberOfTenant" },
        },
        { status: 403 },
      );
    }

    const systemSlug = suResult.slug;
    const newTenantId = suResult.tenantId;
    const oldExp = ctx.tenant.exp ? new Date(ctx.tenant.exp * 1000) : undefined;

    const newToken = await createTenantToken(
      {
        id: newTenantId,
        systemId,
        companyId,
        systemSlug,
        roles: ["admin"],
        actorType: "user",
        actorId: ctx.tenant.actorId,
        exchangeable: true,
      },
      false,
      oldExp,
    );

    // Move the user id from the old tenant's partition to the new one
    // (§8.11, §8.6 step 6).
    await forgetActor(oldTenantId, String(ctx.tenant.actorId));
    await rememberActor(newTenantId, String(ctx.tenant.actorId));

    return Response.json({
      success: true,
      data: {
        systemToken: newToken,
        tenant: {
          id: newTenantId,
          systemId,
          companyId,
          systemSlug,
          roles: ["admin"],
        },
      },
    });
  }

  // Verify membership + resolve slug/roles (§7.2, §8.6)
  const result = await resolveUserExchange(
    ctx.tenant.actorId!,
    companyId,
    systemId,
  );

  if (!result.tenantId) {
    return Response.json(
      {
        success: false,
        error: { code: "FORBIDDEN", message: "auth.error.notMemberOfTenant" },
      },
      { status: 403 },
    );
  }

  const userRoles = result.roles;
  const systemSlug = result.slug;
  const newTenantId = result.tenantId;

  // Carry over remaining lifetime from the old token (§8.6 step 6)
  const oldExp = ctx.tenant.exp ? new Date(ctx.tenant.exp * 1000) : undefined;

  const newToken = await createTenantToken(
    {
      id: newTenantId,
      systemId,
      companyId,
      systemSlug,
      roles: userRoles,
      actorType: "user",
      actorId: ctx.tenant.actorId,
      exchangeable: true,
    },
    false,
    oldExp,
  );

  // Move the user id from the old tenant's partition to the new one
  // (§8.11, §8.6 step 6).
  await forgetActor(oldTenantId, String(ctx.tenant.actorId));
  await rememberActor(newTenantId, String(ctx.tenant.actorId));

  return Response.json({
    success: true,
    data: {
      systemToken: newToken,
      tenant: {
        id: newTenantId,
        systemId,
        companyId,
        systemSlug,
        roles: userRoles,
      },
    },
  });
}

export const POST = compose(
  withAuthRateLimit(),
  withAuth({ requireAuthenticated: true }),
  handler,
);
