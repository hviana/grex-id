import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import type { RequestContext } from "@/src/contracts/auth";
import {
  deleteCompanySystemData,
  verifyUserPassword,
} from "@/server/db/queries/data-deletion";
import { companyExists, getSystemSlug } from "@/server/db/queries/systems";
import { reloadTenant } from "@/server/utils/actor-validity";

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
    ctx.claims?.actorId ?? "0",
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

  await deleteCompanySystemData(companyId, systemId, systemSlug);

  // Rebuild this tenant's actor-validity partition — the batched deletion
  // removed api_tokens and user_company_system rows for (companyId,
  // systemId) (§8.11 rule 2, §9.8).
  await reloadTenant({
    companyId: String(companyId),
    systemId: String(systemId),
  });

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
