import type { Middleware } from "./compose.ts";
import { getDb, rid } from "../db/connection.ts";

/**
 * Middleware that enforces plan entity limits before CREATE operations.
 * Batches all lookups into a single db.query() call (§7.2).
 */
export function withEntityLimit(
  entityName: string,
  tableName: string,
): Middleware {
  return async (_req, ctx, next) => {
    if (!ctx.tenant.companyId || ctx.tenant.systemId) {
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

    // Superusers bypass entity limits
    if (ctx.tenant.roles.includes("superuser")) {
      return next();
    }

    const db = await getDb();

    // Batch: subscription + plan entityLimits + voucher modifiers + current count
    const result = await db.query<
      [
        { planId: string; voucherId: string | null }[],
        { entityLimits: Record<string, number> | null }[],
        { entityLimitModifiers: Record<string, number> | null }[],
        { count: number }[],
      ]
    >(
      `SELECT planId, voucherId FROM subscription
         WHERE companyId = $companyId AND systemId = $systemId AND status = "active"
         LIMIT 1;
       LET $planId = (SELECT VALUE planId FROM subscription
         WHERE companyId = $companyId AND systemId = $systemId AND status = "active" LIMIT 1)[0];
       SELECT entityLimits FROM plan WHERE id = $planId LIMIT 1;
       LET $voucherId = (SELECT VALUE voucherId FROM subscription
         WHERE companyId = $companyId AND systemId = $systemId AND status = "active" LIMIT 1)[0];
       IF $voucherId != NONE {
         SELECT entityLimitModifiers FROM voucher WHERE id = $voucherId LIMIT 1;
       } ELSE {
         SELECT NONE AS entityLimitModifiers LIMIT 0;
       };
       SELECT count() AS count FROM type::table($tableName) WHERE companyId = $companyId GROUP ALL;`,
      {
        companyId: rid(ctx.tenant.companyId),
        systemId: rid(ctx.tenant.systemId),
        tableName,
      },
    );

    const sub = result[0]?.[0];
    if (!sub) return next();

    const plan = result[1]?.[0];
    if (!plan?.entityLimits?.[entityName]) return next();

    let limit = plan.entityLimits[entityName];

    // Apply voucher modifier if applicable
    const voucher = result[2]?.[0];
    if (sub.voucherId && voucher?.entityLimitModifiers?.[entityName]) {
      limit += voucher.entityLimitModifiers[entityName];
    }

    const currentCount = result[3]?.[0]?.count ?? 0;
    if (currentCount >= limit) {
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
