import { compose } from "@/server/middleware/compose";
import { withAuthAndLimit } from "@/server/middleware/withAuthAndLimit";
import type { RequestContext } from "@/src/contracts/high-level/tenant-context";
import { standardizeField } from "@/server/utils/field-standardizer";
import { createTenantToken } from "@/server/utils/token";
import { rememberActor } from "@/server/utils/actor-validity";
import { resolveUserExchange } from "@/server/db/queries/auth";
import { genericCreate, genericList } from "@/server/db/queries/generics";
import { ensureCompanySystemTenant } from "@/server/db/queries/billing";
import { rid } from "@/server/db/connection";
import type { ApiToken } from "@/src/contracts/api-token";
import type { Tenant } from "@/src/contracts/tenant";
import { parseBody } from "@/server/utils/parse-body";

/** resource_limit field names that OAuth may receive from the client. */
const RESOURCE_LIMIT_FIELDS = [
  "credits",
  "roleIds",
  "entityLimits",
  "apiRateLimit",
  "storageLimitBytes",
  "maxConcurrentDownloads",
  "maxConcurrentUploads",
  "maxDownloadBandwidthMB",
  "maxUploadBandwidthMB",
  "maxOperationCountByResourceKey",
  "creditLimitByResourceKey",
  "frontendDomains",
] as const;

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

  const { body, error } = await parseBody(req);
  if (error) return error;
  const { clientName, systemSlug, companyId, redirectOrigin } = body;

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

  const slug = await standardizeField("slug", systemSlug);
  const systemResult = await genericList<{ id: string }>({
    table: "system",
    select: "id",
    extraConditions: ["slug = $slug"],
    extraBindings: { slug },
    limit: 1,
    allowRawExtraConditions: true,
    allowSensitiveGlobalRead: true,
  });
  const systemId = systemResult.items[0]?.id ?? null;
  if (!systemId) {
    return Response.json(
      {
        success: false,
        error: { code: "NOT_FOUND", message: "common.error.notFound" },
      },
      { status: 404 },
    );
  }

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

  const csTenantId = await ensureCompanySystemTenant({
    companyId: String(companyId),
    systemId: String(systemId),
  });

  const tokenTenant: Tenant = {
    id: csTenantId,
    systemId: String(systemId),
    companyId: String(companyId),
  };

  const limitsData: Record<string, unknown> = {};
  for (const field of RESOURCE_LIMIT_FIELDS) {
    if (field in body && body[field] != null) {
      limitsData[field] = body[field];
    }
  }

  if (Array.isArray(limitsData.roleIds) && limitsData.roleIds.length > 0) {
    limitsData.roleIds = (limitsData.roleIds as string[]).map((id: string) =>
      rid(id)
    );
  }

  const rlFields = Object.keys(limitsData).map((field) => ({ field }));

  const apiTokenData: Record<string, unknown> = {
    name: clientName,
    description: redirectOrigin ?? "",
    actorType: "app",
    neverExpires: true,
  };

  const createResult = await genericCreate<ApiToken>(
    {
      table: "api_token",
      tenant: { id: csTenantId },
      fields: [
        { field: "name" },
        { field: "description" },
        { field: "actorType" },
        { field: "neverExpires" },
        { field: "expiresAt" },
      ],
      cascade: [
        {
          table: "resource_limit",
          sourceField: "resourceLimitId",
        },
      ],
      cascadeData: rlFields.length > 0
        ? [{ table: "resource_limit", fields: rlFields, rows: [limitsData] }]
        : undefined,
      allowCreateCallerTenant: true,
    },
    apiTokenData,
  );

  if (!createResult.success || !createResult.data) {
    return Response.json(
      {
        success: false,
        error: { code: "ERROR", message: "common.error.generic" },
      },
      { status: 500 },
    );
  }

  const createdToken = createResult.data;

  const farFuture = new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000);
  const jwt = await createTenantToken(
    {
      ...tokenTenant,
      actorId: String(createdToken.id),
    },
    false,
    farFuture,
  );

  await rememberActor({
    id: csTenantId,
    actorId: String(createdToken.id),
  });

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
