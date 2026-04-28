import { compose } from "@/server/middleware/compose";
import { withAuthAndLimit } from "@/server/middleware/withAuthAndLimit";
import type { RequestContext } from "@/src/contracts/high_level/tenant-context";
import Core from "@/server/utils/Core";
import { createTenantToken } from "@/server/utils/token";
import { forgetActor, rememberActor } from "@/server/utils/actor-validity";
import {
  resolveSuperuserExchange,
  resolveUserExchange,
} from "@/server/db/queries/auth";

async function handler(req: Request, ctx: RequestContext): Promise<Response> {
  const { tenant } = ctx.tenantContext;
  if (!tenant?.actorId) {
    return Response.json(
      {
        success: false,
        error: { code: "UNAUTHORIZED", message: "auth.error.unauthorized" },
      },
      { status: 401 },
    );
  }

  const core = Core.getInstance();
  const actorType = ctx.tenantContext.actorType;

  // Only user tokens can be exchanged (§8.6)
  if (actorType !== "user") {
    return Response.json(
      {
        success: false,
        error: { code: "FORBIDDEN", message: "auth.error.exchangeNotAllowed" },
      },
      { status: 403 },
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

  const oldTenantId = tenant.id!;
  const isSuperuser = ctx.tenantContext.roles.includes("superuser");

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

    const newTenant: typeof tenant = {
      id: suResult.tenantId,
      systemId,
      companyId,
      actorId: tenant.actorId,
    };

    const oldExp = undefined;

    const newToken = await createTenantToken(newTenant, false, oldExp);

    await forgetActor({ id: oldTenantId, actorId: String(tenant.actorId) });
    await rememberActor({
      id: suResult.tenantId,
      actorId: String(tenant.actorId),
    });

    const newRoles = await core.getTenantRoles(newTenant);
    const frontendDomains = await core.getFrontendDomains(newTenant);

    return Response.json({
      success: true,
      data: {
        systemToken: newToken,
        tenant: newTenant,
        roles: newRoles,
        actorType: "user" as const,
        exchangeable: true,
        frontendDomains,
      },
    });
  }

  // Verify membership + resolve slug/roles (§7.2, §8.6)
  const result = await resolveUserExchange(
    tenant.actorId!,
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

  const newTenant: typeof tenant = {
    id: result.tenantId,
    systemId,
    companyId,
    actorId: tenant.actorId,
  };

  const oldExp = undefined;

  const newToken = await createTenantToken(newTenant, false, oldExp);

  await forgetActor({ id: oldTenantId, actorId: String(tenant.actorId) });
  await rememberActor({ id: result.tenantId, actorId: String(tenant.actorId) });

  const newRoles = await core.getTenantRoles(newTenant);
  const frontendDomains = await core.getFrontendDomains(newTenant);

  return Response.json({
    success: true,
    data: {
      systemToken: newToken,
      tenant: newTenant,
      roles: newRoles,
      actorType: "user" as const,
      exchangeable: true,
      frontendDomains,
    },
  });
}

export const POST = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 60 },
    requireAuthenticated: true,
  }),
  handler,
);
