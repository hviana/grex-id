import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import {
  deleteTenantData,
  verifyUserPassword,
} from "@/server/db/queries/data-deletion";
import { companyExists, getSystemSlug } from "@/server/db/queries/systems";
import { reloadTenant } from "@/server/utils/actor-validity";
import { getDb } from "@/server/db/connection";
import type { Tenant } from "@/src/contracts/tenant";

/**
 * Resolves the company-system tenant row (actorId=NONE, companyId, systemId)
 * and returns a full Tenant contract for scoped deletion.
 */
async function resolveCompanySystemTenant(
  companyId: string,
  systemId: string,
  systemSlug: string,
): Promise<Tenant | null> {
  const db = await getDb();
  const result = await db.query<[{ id: string }[]]>(
    `SELECT id FROM tenant
     WHERE actorId IS NONE
       AND companyId = $companyId
       AND systemId = $systemId
     LIMIT 1`,
    { companyId, systemId },
  );
  const row = result[0]?.[0];
  if (!row) return null;
  return {
    id: row.id,
    systemId,
    companyId,
    systemSlug,
    roles: [],
  };
}

async function deleteHandler(req: Request, ctx: RequestContext) {
  const body = await req.json();
  const { companyId, systemId, password } = body;

  if (!companyId || !systemId || !password) {
    return Response.json(
      {
        success: false,
        error: {
          code: "VALIDATION",
          errors: ["core.dataDeletion.error.selectBoth"],
        },
      },
      { status: 400 },
    );
  }

  // Verify the superuser's password
  const passwordValid = await verifyUserPassword(
    ctx.tenant.actorId!,
    password,
  );
  if (!passwordValid) {
    return Response.json(
      {
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "core.dataDeletion.error.passwordInvalid",
        },
      },
      { status: 403 },
    );
  }

  // Look up the system slug for file deletion
  const systemSlug = await getSystemSlug(systemId);

  if (!systemSlug) {
    return Response.json(
      {
        success: false,
        error: {
          code: "NOT_FOUND",
          message: "core.dataDeletion.error.notFound",
        },
      },
      { status: 404 },
    );
  }

  // Verify company exists
  const exists = await companyExists(companyId);
  if (!exists) {
    return Response.json(
      {
        success: false,
        error: {
          code: "NOT_FOUND",
          message: "core.dataDeletion.error.notFound",
        },
      },
      { status: 404 },
    );
  }

  // Resolve the company-system tenant row for scoped deletion
  const tenant = await resolveCompanySystemTenant(companyId, systemId, systemSlug);
  if (!tenant) {
    return Response.json(
      {
        success: false,
        error: {
          code: "NOT_FOUND",
          message: "core.dataDeletion.error.notFound",
        },
      },
      { status: 404 },
    );
  }

  await deleteTenantData(tenant, companyId, systemSlug);

  // Rebuild this tenant's actor-validity partition — the batched deletion
  // removed api_tokens and tenant rows scoped to this tenantId (§8.11, §9.4).
  await reloadTenant(tenant.id);

  return Response.json({
    success: true,
    data: { message: "core.dataDeletion.success" },
  });
}

export const DELETE = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 5 }),
  withAuth({ requireAuthenticated: true, roles: ["superuser"] }),
  deleteHandler,
);
