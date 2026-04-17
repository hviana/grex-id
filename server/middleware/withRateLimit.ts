import type { Middleware } from "./compose.ts";
import { checkRateLimit, type RateLimitConfig } from "../utils/rate-limiter.ts";
import { getDb, rid } from "../db/connection.ts";
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
        const db = await getDb();
        const actorResult = await db.query<[{ count: number }[]]>(
          `SELECT count() AS count FROM (
             SELECT id FROM user_company_system
               WHERE companyId = $companyId AND systemId = $systemId
             UNION ALL
             SELECT id FROM api_token
               WHERE companyId = $companyId AND systemId = $systemId AND revokedAt IS NONE
             UNION ALL
             SELECT id FROM connected_app
               WHERE companyId = $companyId AND systemId = $systemId
           ) GROUP ALL;`,
          {
            companyId: rid(ctx.tenant.companyId),
            systemId: rid(ctx.tenant.systemId),
          },
        );

        const actorCount = Math.max(1, actorResult[0]?.[0]?.count ?? 1);
        const perActorLimit = Math.max(
          1,
          Math.floor(rateLimitResult.globalLimit / actorCount),
        );
        effectiveConfig = {
          windowMs: config.windowMs,
          maxRequests: Math.min(perActorLimit, config.maxRequests),
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
