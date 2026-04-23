import type { Middleware } from "./compose.ts";
import { countEntitiesByCompany } from "../db/queries/entity-limits.ts";
import { resolveEntityLimit } from "../utils/guards.ts";
import { assertServerOnly } from "../utils/server-only.ts";

assertServerOnly("withEntityLimit");

export function withEntityLimit(
  entityName: string,
  tableName: string,
): Middleware {
  return async (_req, ctx, next) => {
    if (!ctx.tenant.companyId || !ctx.tenant.systemId) {
      return Response.json(
        {
          success: false,
          error: {
            code: "BAD_REQUEST",
            message: "common.error.scopeMismatch",
          },
        },
        { status: 400 },
      );
    }

    if (ctx.tenant.roles.includes("superuser")) {
      return next();
    }

    const limitResult = await resolveEntityLimit({
      companyId: ctx.tenant.companyId,
      systemId: ctx.tenant.systemId,
      entityName,
    });

    if (limitResult.limit === null) {
      return next();
    }

    const currentCount = await countEntitiesByCompany(
      tableName,
      ctx.tenant.companyId,
    );
    if (currentCount >= limitResult.limit) {
      return Response.json(
        {
          success: false,
          error: {
            code: "ENTITY_LIMIT",
            message: "billing.error.entityLimit",
          },
        },
        { status: 403 },
      );
    }

    return next();
  };
}
