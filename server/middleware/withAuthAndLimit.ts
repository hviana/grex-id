import type {
  AuthAndLimitOptions,
  Middleware,
} from "@/src/contracts/high-level/middleware";
import { verifyTenantToken } from "../utils/token.ts";
import { enforceCors, getCorsHeaders } from "../utils/cors.ts";
import {
  ensureActorValidityLoaded,
  isActorValid,
} from "../utils/actor-validity.ts";
import { checkRateLimit } from "../utils/rate-limiter.ts";
import { checkPlanAccess, resolveEntityLimit } from "../utils/guards.ts";
import { genericCount } from "../db/queries/generics.ts";
import Core from "../utils/Core.ts";
import { assertServerOnly } from "../utils/server-only.ts";

assertServerOnly("withAuthAndLimit");

/**
 * Unified middleware — the single entry point for all auth, rate-limiting,
 * CORS, plan-access, and entity-limit checks.
 *
 * Execution order (cheapest first):
 * 1. Rate limit (in-memory) — only if rateLimit set; applies to all routes
 * 2. JWT verify — identity-only Tenant payload
 * 3. Resolve auth claims from Core cache → build TenantContext
 * 4. Actor validity (in-memory cache)
 * 5. CORS (no I/O)
 * 6. Set ctx.tenantContext (populated in step 3)
 * 7. Role check — superuser bypass
 * 8. Plan access (Core cache) — subscription + plan roles
 * 9. Entity limit (DB count) — only if entities non-empty
 */
export function withAuthAndLimit(options?: AuthAndLimitOptions): Middleware {
  return async (req, ctx, next) => {
    // ── 1. Rate limit (in-memory, applies to all routes) ──────────────────
    if (options?.rateLimit) {
      const forwarded = req.headers.get("x-forwarded-for");
      const ip = forwarded?.split(",")[0]?.trim() ?? "unknown";
      const pathname = new URL(req.url).pathname;
      const key = `ip:${ip}:${pathname}`;

      const rlResult = checkRateLimit(key, options.rateLimit);
      if (!rlResult.allowed) {
        return Response.json(
          {
            success: false,
            error: {
              code: "RATE_LIMITED",
              message: "common.error.rateLimited",
            },
          },
          {
            status: 429,
            headers: {
              "Retry-After": String(Math.ceil(rlResult.resetMs / 1000)),
              "X-RateLimit-Remaining": "0",
            },
          },
        );
      }
    }

    // ── 2. JWT verify — identity only ────────────────────────────────────
    const authHeader = req.headers.get("Authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      const url = new URL(req.url);
      const isAuthRoute = url.pathname.startsWith("/api/auth/");
      const isPublicDownload = url.pathname === "/api/files/download" &&
        req.method === "GET";

      if (isAuthRoute || isPublicDownload) {
        return next();
      }

      return Response.json(
        {
          success: false,
          error: { code: "UNAUTHORIZED", message: "auth.error.unauthorized" },
        },
        { status: 401 },
      );
    }

    const token = authHeader.slice(7);

    let tenant: {
      id?: string;
      systemId?: string;
      companyId?: string;
      actorId?: string;
    };
    try {
      ({ tenant } = await verifyTenantToken(token));
    } catch {
      return Response.json(
        {
          success: false,
          error: { code: "UNAUTHORIZED", message: "auth.error.invalidToken" },
        },
        { status: 401 },
      );
    }

    const tenantId = tenant.id ?? "";
    const actorId = tenant.actorId;

    // ── 3. Resolve auth claims from Core cache → build TenantContext ──────
    const core = Core.getInstance();
    const actorType = Core.deriveActorType(actorId) ?? "user";
    const roles = actorId ? await core.getTenantRoles(tenant) : ["superuser"];
    const systemId = tenant.systemId;
    const companyId = tenant.companyId;
    const frontendDomains = (systemId && companyId)
      ? await core.getFrontendDomains(tenant)
      : [];
    const systemSlug = systemId
      ? (await core.getSystemSlug(systemId)) ?? undefined
      : undefined;

    // Set ctx.tenantContext with ALL resolved data
    ctx.tenantContext = {
      tenant: {
        id: tenantId,
        systemId,
        companyId,
        actorId,
      },
      roles,
      actorType,
      exchangeable: actorType === "user",
      frontendDomains,
      systemSlug,
    };

    const tc = ctx.tenantContext;

    // ── 4. Actor validity ──────────────────────────────────────────────
    await ensureActorValidityLoaded(tc.tenant);
    if (!tc.tenant.actorId || !isActorValid(tc.tenant)) {
      return Response.json(
        {
          success: false,
          error: { code: "UNAUTHORIZED", message: "auth.error.tokenRevoked" },
        },
        { status: 401 },
      );
    }

    // ── 5. CORS ────────────────────────────────────────────────────────
    const corsError = enforceCors(req, tc.actorType, tc.frontendDomains);
    if (corsError) return corsError;

    // ── 7. Role check — superuser bypass ───────────────────────────────
    if (tc.roles.includes("superuser") || tc.roles.includes("anonymous")) {
      const response = await next();
      if (tc.actorType !== "user") {
        const corsHeaders = getCorsHeaders(
          req,
          tc.actorType,
          tc.frontendDomains,
        );
        for (const [key, value] of Object.entries(corsHeaders)) {
          response.headers.set(key, value);
        }
      }
      return response;
    }

    // Role-based authorization
    if (options?.roles && options.roles.length > 0) {
      const hasRole = options.roles.some((r) => tc.roles.includes(r));
      if (!hasRole) {
        return Response.json(
          {
            success: false,
            error: {
              code: "FORBIDDEN",
              message: "auth.error.insufficientRole",
            },
          },
          { status: 403 },
        );
      }
    }

    // ── 8. Plan access (Core cache) ────────────────────────────────────
    if (tc.tenant.companyId && tc.tenant.systemId) {
      const planResult = await checkPlanAccess(tc.tenant, tc.roles);
      if (!planResult.granted) {
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
        const error = errorMap[planResult.denyCode!] ?? {
          code: "PLAN_LIMIT",
          message: "billing.error.planLimit",
        };
        return Response.json(
          { success: false, error },
          { status: 403 },
        );
      }
    }

    // ── 9. Entity limit (DB count) ─────────────────────────────────────
    if (options?.entities && options.entities.length > 0) {
      for (const tableName of options.entities) {
        const limitResult = await resolveEntityLimit({
          tenant: tc.tenant,
          entityName: tableName,
        });

        if (limitResult.limit !== null) {
          const currentCount = await genericCount({
            table: tableName,
            tenant: tc.tenant,
          });
          if (currentCount >= limitResult.limit) {
            return Response.json(
              {
                success: false,
                error: {
                  code: "ENTITY_LIMIT",
                  message: "billing.error.entityLimit",
                },
              },
              { status: 403 },
            );
          }
        }
      }
    }

    // ── Execute handler ────────────────────────────────────────────────
    const response = await next();

    if (tc.actorType !== "user") {
      const corsHeaders = getCorsHeaders(req, tc.actorType, tc.frontendDomains);
      for (const [key, value] of Object.entries(corsHeaders)) {
        response.headers.set(key, value);
      }
    }

    return response;
  };
}
