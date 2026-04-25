import type { Middleware } from "./compose.ts";
import { verifyTenantToken } from "../utils/token.ts";
import { enforceCors, getCorsHeaders } from "../utils/cors.ts";
import {
  ensureActorValidityLoaded,
  isActorValid,
} from "../utils/actor-validity.ts";
import { assertServerOnly } from "../utils/server-only.ts";

assertServerOnly("withAuth");

/**
 * Authenticates a request without touching the database (§8.11).
 *
 * Flow:
 *   1. No `Authorization: Bearer` and not an auth route → return 401.
 *      Every non-auth route requires a bearer token (including the
 *      anonymous API token for public operations).
 *   2. No `Authorization: Bearer` on auth routes → proceed without
 *      populating ctx.tenant/ctx.claims (auth routes only use withRateLimit).
 *   3. Otherwise verify the JWT; claims carry Tenant + universal actorId +
 *      frontendUse/frontendDomains (for api_token actors).
 *   4. Load the tenant's actor-validity partition on first use and check
 *      `isActorValid(tenant, actorId)`.
 *   5. Enforce CORS using the claims (no DB read).
 *   6. Apply role/permission gates; superusers bypass them.
 */
export function withAuth(
  options?: {
    roles?: string[];
    permissions?: string[];
    requireAuthenticated?: boolean;
  },
): Middleware {
  return async (req, ctx, next) => {
    const authHeader = req.headers.get("Authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      const url = new URL(req.url);
      const isAuthRoute = url.pathname.startsWith("/api/auth/");

      if (isAuthRoute) {
        // Auth routes proceed without tenant context
        return next();
      }

      // All other routes require a bearer token
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

    const token = authHeader.slice(7);

    // Auth-only verification — narrow catch so handler errors propagate.
    let claims;
    try {
      claims = await verifyTenantToken(token);
    } catch {
      return Response.json(
        {
          success: false,
          error: {
            code: "UNAUTHORIZED",
            message: "auth.error.invalidToken",
          },
        },
        { status: 401 },
      );
    }

    // Cache-only validity check (§8.11). One call covers every actor
    // type because the cache is keyed by (tenant, actorId).
    await ensureActorValidityLoaded(claims);
    if (!claims.actorId || !isActorValid(claims, claims.actorId)) {
      return Response.json(
        {
          success: false,
          error: {
            code: "UNAUTHORIZED",
            message: "auth.error.tokenRevoked",
          },
        },
        { status: 401 },
      );
    }

    // CORS policy lives on the JWT itself for non-user actors (§8.12).
    const corsError = enforceCors(req, claims);
    if (corsError) return corsError;

    ctx.tenant = {
      systemId: claims.systemId,
      companyId: claims.companyId,
      systemSlug: claims.systemSlug,
      roles: claims.roles,
      permissions: claims.permissions,
    };
    ctx.claims = claims;

    if (ctx.tenant.roles.includes("superuser")) {
      const response = await next();
      if (ctx.claims.actorType !== "user") {
        const corsHeaders = getCorsHeaders(req, ctx.claims);
        for (const [key, value] of Object.entries(corsHeaders)) {
          response.headers.set(key, value);
        }
      }
      return response;
    }

    if (options?.roles && options.roles.length > 0) {
      const hasRole = options.roles.some((r) => ctx.tenant.roles.includes(r));
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

    if (options?.permissions && options.permissions.length > 0) {
      const hasPermission = ctx.tenant.permissions.includes("*") ||
        options.permissions.some((p) => ctx.tenant.permissions.includes(p));
      if (!hasPermission) {
        return Response.json(
          {
            success: false,
            error: {
              code: "FORBIDDEN",
              message: "auth.error.insufficientPermissions",
            },
          },
          { status: 403 },
        );
      }
    }

    const response = await next();

    if (ctx.claims.actorType !== "user") {
      const corsHeaders = getCorsHeaders(req, ctx.claims);
      for (const [key, value] of Object.entries(corsHeaders)) {
        response.headers.set(key, value);
      }
    }

    return response;
  };
}
