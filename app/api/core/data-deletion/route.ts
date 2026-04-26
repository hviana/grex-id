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

/**
 * Resolves the company-system tenant row (actorId=NONE, companyId, systemId)
 * to obtain the tenantId needed for scoped deletion.
 */
async function resolveCompanySystemTenantId(
  companyId: string,
  systemId: string,
): Promise<string | null> {
  const db = await getDb();
  const result = await db.query<[{ id: string }[]]>(
    `SELECT id FROM tenant
     WHERE actorId IS NONE
       AND companyId = $companyId
       AND systemId = $systemId
     LIMIT 1`,
    { companyId, systemId },
  );
  return result[0]?.[0]?.id ?? null;
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
    ctx.claims!.actorId,
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
  const tenantId = await resolveCompanySystemTenantId(companyId, systemId);
  if (!tenantId) {
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

  await deleteTenantData(tenantId, companyId, systemSlug);

  // Rebuild this tenant's actor-validity partition — the batched deletion
  // removed api_tokens and tenant rows scoped to this tenantId (§8.11, §9.4).
  await reloadTenant(tenantId);

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
