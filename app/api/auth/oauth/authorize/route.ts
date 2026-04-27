import { compose } from "@/server/middleware/compose";
import { withAuthAndLimit } from "@/server/middleware/withAuthAndLimit";
import type { RequestContext } from "@/src/contracts/high_level/tenant-context";
import Core from "@/server/utils/Core";
import { standardizeField } from "@/server/utils/field-standardizer";
import { createTenantToken } from "@/server/utils/token";
import { rememberActor } from "@/server/utils/actor-validity";
import {
  findSystemIdBySlug,
  resolveUserExchange,
} from "@/server/db/queries/auth";
import { createTokenWithResourceLimit } from "@/server/db/queries/tokens";
import type { Tenant } from "@/src/contracts/tenant";

async function handler(req: Request, ctx: RequestContext): Promise<Response> {
  if (!ctx.tenantContext.tenant.actorId) {
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
    maxOperationCountByResourceKey,
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

  const userId = ctx.tenantContext.tenant.actorId;

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

  const tokenTenant: Tenant = {
    id: resolved.tenantId,
    systemId: String(systemId),
    companyId: String(companyId),
  };

  const resourceLimits: Record<string, unknown> = { roleIds: grantedRoles };
  if (monthlySpendLimit != null) {
    resourceLimits.creditLimitByResourceKey = {
      default: Number(monthlySpendLimit),
    };
  }
  if (maxOperationCountByResourceKey != null) {
    resourceLimits.maxOperationCountByResourceKey =
      maxOperationCountByResourceKey;
  }

  const createdToken = await createTokenWithResourceLimit({
    name: clientName,
    description: redirectOrigin ?? "",
    actorType: "app",
    tenantId: resolved.tenantId,
    resourceLimits,
    neverExpires: true,
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
      actorId: String(createdToken.id),
    },
    false,
    farFuture,
  );

  await rememberActor(resolved.tenantId, String(createdToken.id));

  return Response.json(
    { success: true, data: { token: jwt } },
    { status: 201 },
  );
}

export const POST = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 5 },
    requireAuthenticated: true,
  }),
  handler,
);
