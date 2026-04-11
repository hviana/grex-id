import type { Middleware } from "./compose";
import { checkRateLimit, type RateLimitConfig } from "../utils/rate-limiter";

export function withRateLimit(config: RateLimitConfig): Middleware {
  return async (req, ctx, next) => {
    const forwarded = req.headers.get("x-forwarded-for");
    const ip = forwarded?.split(",")[0]?.trim() ?? "unknown";

    const key = ctx.companyId && ctx.systemId
      ? `${ctx.companyId}:${ctx.systemId}`
      : `ip:${ip}`;

    const result = checkRateLimit(key, config);

    if (!result.allowed) {
      return Response.json(
        {
          success: false,
          error: { code: "RATE_LIMITED", message: "Too many requests" },
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
