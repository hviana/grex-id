import type { Middleware } from "./compose.ts";
import { checkRateLimit, type RateLimitConfig } from "../utils/rate-limiter.ts";
import { resolveRateLimitConfig } from "../utils/guards.ts";
import { assertServerOnly } from "../utils/server-only.ts";

assertServerOnly("withRateLimit");

export function withRateLimit(config: RateLimitConfig): Middleware {
  return async (req, ctx, next) => {
    const forwarded = req.headers.get("x-forwarded-for");
    const ip = forwarded?.split(",")[0]?.trim() ?? "unknown";

    // Auth routes (no tenant context) use IP-based rate limiting
    const hasTenant = ctx.tenant?.id;

    let effectiveConfig = config;

    if (hasTenant) {
      const rateLimitResult = await resolveRateLimitConfig({
        tenant: ctx.tenant,
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

    const key = hasTenant ? ctx.tenant.id : `ip:${ip}`;

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
