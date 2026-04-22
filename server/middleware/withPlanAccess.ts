import type { Middleware } from "./compose.ts";
import { checkPlanAccess } from "../utils/guards.ts";
import { assertServerOnly } from "../utils/server-only.ts";

assertServerOnly("withPlanAccess");

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

    const result = await checkPlanAccess(ctx.tenant, featureNames);

    if (!result.granted) {
      const errorMap: Record<string, { code: string; message: string }> = {
        NO_SUBSCRIPTION: {
          code: "NO_SUBSCRIPTION",
          message: "billing.error.noSubscription",
        },
        SUBSCRIPTION_EXPIRED: {
          code: "SUBSCRIPTION_EXPIRED",
          message: "billing.error.subscriptionExpired",
        },
        PLAN_LIMIT: {
          code: "PLAN_LIMIT",
          message: "billing.error.planLimit",
        },
      };
      const error = errorMap[result.denyCode!] ?? {
        code: "PLAN_LIMIT",
        message: "billing.error.planLimit",
      };
      return Response.json(
        { success: false, error },
        { status: 403 },
      );
    }

    return next();
  };
}
