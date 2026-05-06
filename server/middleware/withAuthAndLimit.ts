import "server-only";

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
import { deriveActorType, get, limitsMerger } from "../utils/cache.ts";

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
      const isApprovalsRoute = url.pathname === "/api/approvals";
      const isPublicDownload = url.pathname === "/api/files/download" &&
        req.method === "GET";

      if (isAuthRoute || isApprovalsRoute || isPublicDownload) {
        if (options?.requireAuthenticated) {
          return Response.json(
            {
              success: false,
              error: {
                code: "UNAUTHORIZED",
                message: "auth.error.unauthorized",
              },
            },
            { status: 401 },
          );
        }
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
    const actorType = deriveActorType(actorId) ?? "user";
    const systemId = tenant.systemId;
    const companyId = tenant.companyId;
    const rolesResult = (actorId && systemId)
      ? (await get(
        { systemId, companyId, actorId },
        "roles",
      )) as { names: string[]; ids: string[] } | undefined
      : undefined;
    const roles = rolesResult?.names ?? [];
    const roleIds = rolesResult?.ids ?? [];
    const frontendDomains = (systemId && companyId)
      ? ((await get(
        { systemId, companyId, actorId },
        "limits",
        limitsMerger,
      ) as any)?.frontendDomains ?? [])
      : [];
    const coreData = await get(undefined, "core-data") as any;
    const systemSlug = systemId
      ? coreData?.systemsById?.[systemId]?.slug
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
    // Anonymous tokens serve public endpoints — they are not subject to
    // CORS enforcement (which restricts non-user tokens to specific domains).
    const corsError = tc.roles.includes("anonymous")
      ? null
      : enforceCors(req, tc.actorType, tc.frontendDomains);
    if (corsError) return corsError;

    // ── 7. Access check — superuser/anonymous bypass, then rule evaluation ─
    //
    // Superuser and anonymous roles bypass all access checks.
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

    // Access rule evaluation.
    //
    // Each element in `accesses` is checked in order. The first rule that
    // satisfies its conditions grants access. If no rule matches, access is
    // denied (403).
    //
    // Pseudocode:
    //   FOR EACH access IN options.accesses:
    //     IF access.systemSlug is specified:
    //       Resolve the system from coreData.systemsBySlug
    //       IF system not found → CONTINUE (skip this rule)
    //       IF access.roles is specified and non-empty:
    //         Look up role IDs for this system from coreData.rolesBySystem
    //         Filter to those whose name appears in access.roles
    //         Check if user's roleIds overlap with those system-scoped IDs
    //         IF overlap → GRANT, ELSE → CONTINUE
    //       ELSE (systemSlug only, no roles):
    //         Any authenticated actor in this system passes.
    //         Check tc.systemSlug === access.systemSlug
    //         IF match → GRANT, ELSE → CONTINUE
    //     ELSE (no systemSlug):
    //       IF access.roles is specified and non-empty:
    //         Check if user has any of the named roles (by name, any system)
    //         IF match → GRANT, ELSE → CONTINUE
    //       ELSE (neither systemSlug nor roles):
    //         No restrictions → GRANT immediately
    //
    if (options?.accesses && options.accesses.length > 0) {
      let granted = false;

      for (const access of options.accesses) {
        const hasSystemSlug = !!access.systemSlug;
        const hasRoles = !!(access.roles && access.roles.length > 0);

        // No restrictions at all → grant immediately
        if (!hasSystemSlug && !hasRoles) {
          granted = true;
          break;
        }

        if (hasSystemSlug) {
          // Resolve the target system
          const targetSystem = coreData?.systemsBySlug?.[access.systemSlug!];
          if (!targetSystem) continue;

          if (hasRoles) {
            // System + roles: check user has any named role specifically
            // within this system, verified via roleIds intersection.
            const systemRoles = coreData?.rolesBySystem?.[targetSystem.id] ??
              [];
            const matchingIds = new Set<string>();
            for (const sr of systemRoles) {
              if (access.roles!.includes(sr.name)) {
                matchingIds.add(String(sr.id));
              }
            }
            granted = roleIds.some((id: string) => matchingIds.has(id));
          } else {
            // System only, no roles: any authenticated actor in the system.
            granted = tc.systemSlug === access.systemSlug;
          }
        } else {
          // No system, roles only: check by name across all systems.
          granted = access.roles!.some((r: string) => tc.roles.includes(r));
        }

        if (granted) break;
      }

      if (!granted) {
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
          const currentCount = (await genericCount({
            table: tableName,
            tenant: tc.tenant,
          })) as number;
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
