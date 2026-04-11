import type { Middleware } from "./compose";
import { getDb } from "../db/connection";

export function withPlanAccess(featureNames: string[]): Middleware {
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

    const subs = await db.query<
      [{ planId: string; status: string; currentPeriodEnd: string }[]]
    >(
      `SELECT planId, status, currentPeriodEnd FROM subscription
       WHERE companyId = $companyId AND systemId = $systemId AND status = "active"
       LIMIT 1`,
      { companyId: ctx.companyId, systemId: ctx.systemId },
    );

    const sub = subs[0]?.[0];
    if (!sub) {
      return Response.json(
        {
          success: false,
          error: {
            code: "NO_SUBSCRIPTION",
            message: "No active subscription found",
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
            message: "Subscription period has ended",
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
              message: "This feature is not included in your plan",
            },
          },
          { status: 403 },
        );
      }
    }

    return next();
  };
}
