import type { Middleware } from "./compose.ts";
import { checkRateLimit, type RateLimitConfig } from "../utils/rate-limiter.ts";
import { resolveRateLimitConfig } from "../utils/guards.ts";

export function withRateLimit(config: RateLimitConfig): Middleware {
  return async (req, ctx, next) => {
    const forwarded = req.headers.get("x-forwarded-for");
    const ip = forwarded?.split(",")[0]?.trim() ?? "unknown";

    const hasTenant = ctx.tenant.companyId &&
      ctx.tenant.systemId &&
      ctx.tenant.companyId !== "0" &&
      ctx.tenant.systemId !== "0";

    let effectiveConfig = config;

    if (hasTenant) {
      const rateLimitResult = await resolveRateLimitConfig({
        companyId: ctx.tenant.companyId,
        systemId: ctx.tenant.systemId,
      });

      if (rateLimitResult.globalLimit > 0) {
        effectiveConfig = {
          windowMs: config.windowMs,
          maxRequests: Math.min(
            rateLimitResult.globalLimit,
            config.maxRequests,
          ),
        };
      }
    }

    const key = hasTenant
      ? `${ctx.tenant.companyId}:${ctx.tenant.systemId}`
      : `ip:${ip}`;

    const result = checkRateLimit(key, effectiveConfig);

    if (!result.allowed) {
      return Response.json(
        {
          success: false,
          error: { code: "RATE_LIMITED", message: "common.error.rateLimited" },
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil(result.resetMs / 1000)),
            "X-RateLimit-Remaining": "0",
          },
        },
      );
    }

    const response = await next();
    return response;
  };
}
