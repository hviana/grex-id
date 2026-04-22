import type { Middleware } from "./compose.ts";
import { verifyTenantToken } from "../utils/token.ts";
import { enforceCors, getCorsHeaders } from "../utils/cors.ts";
import { getAnonymousTenant } from "../utils/tenant.ts";
import {
  ensureActorValidityLoaded,
  isActorValid,
} from "../utils/actor-validity.ts";

/**
 * Authenticates a request without touching the database (§12.8).
 *
 * Flow:
 *   1. No `Authorization: Bearer` → synthesize anonymous Tenant (§9.2).
 *   2. Otherwise verify the JWT; claims carry Tenant + universal actorId +
 *      frontendUse/frontendDomains (for api_token actors).
 *   3. Load the tenant's actor-validity partition on first use and check
 *      `isActorValid(tenant, actorId)`.
 *   4. Enforce CORS using the claims (no DB read).
 *   5. Apply role/permission gates; superusers bypass them.
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

      const url = new URL(req.url);
      let systemSlug = "core";
      if (
        url.pathname.startsWith("/api/core/") ||
        url.pathname.startsWith("/api/auth/")
      ) {
        systemSlug = "core";
      } else if (url.pathname.startsWith("/api/public/")) {
        systemSlug = url.searchParams.get("slug") ??
          url.searchParams.get("systemSlug") ?? "core";
      } else if (url.pathname.match(/^\/api\/systems\/([^/]+)/)) {
        const match = url.pathname.match(/^\/api\/systems\/([^/]+)/);
        systemSlug = match?.[1] ?? "core";
      } else {
        systemSlug = url.searchParams.get("systemSlug") ?? "core";
      }

      ctx.tenant = getAnonymousTenant(systemSlug);
      ctx.claims = undefined;
      return next();
    }

    const token = authHeader.slice(7);

    try {
      const claims = await verifyTenantToken(token);

      // Cache-only validity check (§12.8). One call covers every actor
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

      // CORS policy lives on the JWT itself for non-user actors (§12.7).
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
  };
}
