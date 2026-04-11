import type { Middleware } from "./compose";
import { getDb } from "../db/connection";

export function withEntityLimit(
  entityName: string,
  tableName: string,
): Middleware {
  return async (_req, ctx, next) => {
    if (!ctx.companyId || !ctx.systemId) {
      return Response.json(
        {
          success: false,
          error: {
            code: "BAD_REQUEST",
            message: "Company and system context required",
          },
        },
        { status: 400 },
      );
    }

    if (ctx.roles.includes("superuser")) {
      return next();
    }

    const db = await getDb();

    const subs = await db.query<[{ planId: string; voucherIds: string[] }[]]>(
      `SELECT planId, voucherIds FROM subscription
       WHERE companyId = $companyId AND systemId = $systemId AND status = "active"
       LIMIT 1`,
      { companyId: ctx.companyId, systemId: ctx.systemId },
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

    if (sub.voucherIds.length > 0) {
      const vouchers = await db.query<
        [{ entityLimitModifiers: Record<string, number> | null }[]]
      >(
        "SELECT entityLimitModifiers FROM voucher WHERE id IN $ids",
        { ids: sub.voucherIds },
      );
      for (const v of vouchers[0] ?? []) {
        if (v.entityLimitModifiers?.[entityName]) {
          limit += v.entityLimitModifiers[entityName];
        }
      }
    }

    const counts = await db.query<[{ count: number }[]]>(
      `SELECT count() AS count FROM ${tableName} WHERE companyId = $companyId GROUP ALL`,
      { companyId: ctx.companyId },
    );

    const currentCount = counts[0]?.[0]?.count ?? 0;
    if (currentCount >= limit) {
      return Response.json(
        {
          success: false,
          error: {
            code: "ENTITY_LIMIT",
            message:
              `Entity limit reached for ${entityName} (${currentCount}/${limit})`,
          },
        },
        { status: 403 },
      );
    }

    return next();
  };
}
