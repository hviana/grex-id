import type { Middleware } from "./compose.ts";
import { getDb, rid } from "../db/connection.ts";

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

    const db = await getDb();

    const subs = await db.query<
      [{ planId: string; voucherId: string | null }[]]
    >(
      `SELECT planId, voucherId FROM subscription
       WHERE companyId = $companyId AND systemId = $systemId AND status = "active"
       LIMIT 1`,
      {
        companyId: rid(ctx.tenant.companyId),
        systemId: rid(ctx.tenant.systemId),
      },
    );

    const sub = subs[0]?.[0];
    if (!sub) return next();

    const plans = await db.query<
      [{ entityLimits: Record<string, number> | null }[]]
    >(
      "SELECT entityLimits FROM plan WHERE id = $planId LIMIT 1",
      { planId: sub.planId },
    );

    const plan = plans[0]?.[0];
    if (!plan?.entityLimits?.[entityName]) return next();

    let limit = plan.entityLimits[entityName];

    // Single voucher — check for entityLimitModifiers
    if (sub.voucherId) {
      const vouchers = await db.query<
        [{ entityLimitModifiers: Record<string, number> | null }[]]
      >(
        "SELECT entityLimitModifiers FROM voucher WHERE id = $id LIMIT 1",
        { id: sub.voucherId },
      );
      const v = vouchers[0]?.[0];
      if (v?.entityLimitModifiers?.[entityName]) {
        limit += v.entityLimitModifiers[entityName];
      }
    }

    const counts = await db.query<[{ count: number }[]]>(
      `SELECT count() AS count FROM ${tableName} WHERE companyId = $companyId GROUP ALL`,
      { companyId: rid(ctx.tenant.companyId) },
    );

    const currentCount = counts[0]?.[0]?.count ?? 0;
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
