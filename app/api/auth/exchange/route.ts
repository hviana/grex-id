import { compose } from "@/server/middleware/compose";
import { withAuthAndLimit } from "@/server/middleware/withAuthAndLimit";
import type { RequestContext } from "@/src/contracts/high-level/tenant-context";
import { get, limitsMerger } from "@/server/utils/cache";
import { createTenantToken } from "@/server/utils/token";
import { rememberActor } from "@/server/utils/actor-validity";
import {
  resolveSuperuserExchange,
  resolveUserExchange,
} from "@/server/db/queries/auth";
import { parseBody } from "@/server/utils/parse-body";

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

  const { body, error } = await parseBody(req);
  if (error) return error;
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

    await rememberActor({
      id: suResult.tenantId,
      actorId: String(tenant.actorId),
    });

    const rawRoles = await get(newTenant, "roles");
    const newRoles = Array.isArray((rawRoles as any)?.names)
      ? (rawRoles as any).names as string[]
      : Array.isArray(rawRoles)
      ? rawRoles as string[]
      : [];
    const frontendDomains =
      ((await get(newTenant, "limits", limitsMerger)) as any)
        ?.frontendDomains ?? [];

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

  await rememberActor({ id: result.tenantId, actorId: String(tenant.actorId) });

  const rawRoles2 = await get(newTenant, "roles");
  const newRoles = Array.isArray((rawRoles2 as any)?.names)
    ? (rawRoles2 as any).names as string[]
    : Array.isArray(rawRoles2)
    ? rawRoles2 as string[]
    : [];
  const frontendDomains =
    ((await get(newTenant, "limits", limitsMerger)) as any)?.frontendDomains ??
      [];

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
