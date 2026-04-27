import { compose } from "@/server/middleware/compose";
import { withAuthAndLimit } from "@/server/middleware/withAuthAndLimit";

import type { RequestContext } from "@/src/contracts/high_level/tenant-context";
import { deleteTenantData } from "@/server/db/queries/data-deletion";
import { genericGetById, genericVerify } from "@/server/db/queries/generics";
import { fetchCompanySystemTenantRow } from "@/server/db/queries/tenants";
import { reloadTenant } from "@/server/utils/actor-validity";
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
  const row = await fetchCompanySystemTenantRow(companyId, systemId);
  if (!row) return null;
  return {
    id: row.id,
    systemId,
    companyId,
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
  const passwordValid = await genericVerify(
    { table: "user", hashField: "passwordHash" },
    ctx.tenantContext.tenant.actorId!,
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
  const system = await genericGetById<{ slug: string }>(
    { table: "system" },
    systemId,
  );
  const systemSlug = system?.slug ?? null;

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
  const exists =
    (await genericGetById({ table: "company" }, companyId)) !== null;
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
  const tenant = await resolveCompanySystemTenant(
    companyId,
    systemId,
    systemSlug,
  );
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
  await reloadTenant(tenant.id!);

  return Response.json({
    success: true,
    data: { message: "core.dataDeletion.success" },
  });
}

export const DELETE = compose(
  withAuthAndLimit({

    rateLimit: { windowMs: 60_000, maxRequests: 5 },
    roles: ["superuser"],

  }),
  deleteHandler,
);
