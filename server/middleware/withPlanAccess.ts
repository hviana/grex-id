import type { Middleware } from "./compose.ts";
import { getDb } from "../db/connection.ts";

export function withPlanAccess(featureNames: string[]): Middleware {
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
      [{ planId: string; status: string; currentPeriodEnd: string }[]]
    >(
      `SELECT planId, status, currentPeriodEnd FROM subscription
       WHERE companyId = $companyId AND systemId = $systemId AND status = "active"
       LIMIT 1`,
      { companyId: ctx.tenant.companyId, systemId: ctx.tenant.systemId },
    );

    const sub = subs[0]?.[0];
    if (!sub) {
      return Response.json(
        {
          success: false,
          error: {
            code: "NO_SUBSCRIPTION",
            message: "billing.error.noSubscription",
          },
        },
        { status: 403 },
      );
    }

    if (new Date(sub.currentPeriodEnd) < new Date()) {
      return Response.json(
        {
          success: false,
          error: {
            code: "SUBSCRIPTION_EXPIRED",
            message: "billing.error.subscriptionExpired",
          },
        },
        { status: 403 },
      );
    }

    const plans = await db.query<[{ permissions: string[] }[]]>(
      "SELECT permissions FROM plan WHERE id = $planId LIMIT 1",
      { planId: sub.planId },
    );

    const plan = plans[0]?.[0];
    if (plan && !plan.permissions.includes("*")) {
      const hasAccess = featureNames.some((f) => plan.permissions.includes(f));
      if (!hasAccess) {
        return Response.json(
          {
            success: false,
            error: {
              code: "PLAN_LIMIT",
              message: "billing.error.planLimit",
            },
          },
          { status: 403 },
        );
      }
    }

    return next();
  };
}
