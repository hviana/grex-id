import type { Middleware } from "./compose.ts";
import { getDb, rid } from "../db/connection.ts";
import { resolveEntityLimit } from "../utils/guards.ts";

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

    const db = await getDb();
    const countResult = await db.query<[{ count: number }[]]>(
      `SELECT count() AS count FROM type::table($tableName) WHERE companyId = $companyId GROUP ALL;`,
      {
        companyId: rid(ctx.tenant.companyId),
        tableName,
      },
    );

    const currentCount = countResult[0]?.[0]?.count ?? 0;
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
