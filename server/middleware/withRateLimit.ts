import type { Middleware } from "./compose.ts";
import { checkRateLimit, type RateLimitConfig } from "../utils/rate-limiter.ts";
import { getDb, rid } from "../db/connection.ts";

/**
 * Rate-limit middleware.
 *
 * For authenticated tenants (companyId + systemId present):
 *   - Fetches plan.apiRateLimit + voucher.apiRateLimitModifier
 *   - Counts active actors (user + api_token + connected_app sessions)
 *   - Computes per-actor limit: floor(globalLimit / activeActorCount), min 1
 *   - config.maxRequests serves as a per-route floor override
 *
 * For anonymous requests (no tenant):
 *   - Uses config values directly (static per-route limits)
 */
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
      const db = await getDb();

      // Batch: plan rate limit + voucher modifier + active actor count (§7.2)
      const result = await db.query<
        [
          { apiRateLimit: number }[],
          { apiRateLimitModifier: number }[],
          { count: number }[],
        ]
      >(
        `LET $planId = (SELECT VALUE planId FROM subscription
           WHERE companyId = $companyId AND systemId = $systemId AND status = "active"
           LIMIT 1)[0];
         SELECT apiRateLimit FROM plan WHERE id = $planId LIMIT 1;
         LET $voucherId = (SELECT VALUE voucherId FROM subscription
           WHERE companyId = $companyId AND systemId = $systemId AND status = "active"
           LIMIT 1)[0];
         IF $voucherId != NONE {
           SELECT apiRateLimitModifier FROM voucher WHERE id = $voucherId LIMIT 1;
         } ELSE {
           SELECT NONE AS apiRateLimitModifier LIMIT 0;
         };
         SELECT count() AS count FROM (
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

      const planRateLimit = result[0]?.[0]?.apiRateLimit ?? 0;
      const voucherModifier = result[1]?.[0]?.apiRateLimitModifier ?? 0;
      const globalLimit = planRateLimit + voucherModifier;
      const actorCount = Math.max(1, result[2]?.[0]?.count ?? 1);

      if (globalLimit > 0) {
        const perActorLimit = Math.max(1, Math.floor(globalLimit / actorCount));
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
