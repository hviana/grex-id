import type { Middleware } from "./compose.ts";
import { checkRateLimit, type RateLimitConfig } from "../utils/rate-limiter.ts";

export function withRateLimit(config: RateLimitConfig): Middleware {
  return async (req, ctx, next) => {
    const forwarded = req.headers.get("x-forwarded-for");
    const ip = forwarded?.split(",")[0]?.trim() ?? "unknown";

    const key = ctx.tenant.companyId && ctx.tenant.systemId
      ? `${ctx.tenant.companyId}:${ctx.tenant.systemId}`
      : `ip:${ip}`;

    const result = checkRateLimit(key, config);

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
