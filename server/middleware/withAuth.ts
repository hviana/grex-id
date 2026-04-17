import type { Middleware } from "./compose.ts";
import type { RequestContext } from "@/src/contracts/auth.ts";
import type { TenantClaims } from "@/src/contracts/tenant.ts";
import type { ApiToken } from "@/src/contracts/token.ts";
import { hashToken, verifyTenantToken } from "../utils/token.ts";
import { findTokenByHash } from "../db/queries/tokens.ts";
import { isJtiRevoked } from "../utils/token-revocation.ts";
import { enforceCors, getCorsHeaders } from "../utils/cors.ts";
import { getAnonymousTenant } from "../utils/tenant.ts";

function isLikelyJwt(token: string): boolean {
  return token.split(".").length === 3;
}

/**
 * Constructs a RequestContext from a verified TenantClaims.
 * Used by both JWT and API token paths.
 */
function buildContext(
  claims: TenantClaims,
): RequestContext {
  return {
    tenant: {
      systemId: claims.systemId,
      companyId: claims.companyId,
      systemSlug: claims.systemSlug,
      roles: claims.roles,
      permissions: claims.permissions,
    },
    claims,
  };
}

/**
 * Constructs a RequestContext from an API token row.
 * Maps flat fields to the Tenant interface.
 */
function buildContextFromApiToken(
  apiToken: ApiToken,
): RequestContext {
  // Prefer embedded tenant object, fall back to flat fields
  const tenant = apiToken.tenant ?? {
    systemId: String(apiToken.systemId),
    companyId: String(apiToken.companyId),
    systemSlug: "",
    roles: [],
    permissions: apiToken.permissions ?? [],
  };

  return {
    tenant,
    claims: {
      ...tenant,
      actorType: "api_token",
      actorId: String(apiToken.id),
      jti: apiToken.jti ?? "",
      exchangeable: false,
    },
  };
}

export function withAuth(
  options?: {
    roles?: string[];
    permissions?: string[];
    requireAuthenticated?: boolean;
  },
): Middleware {
  return async (req, ctx, next) => {
    const authHeader = req.headers.get("Authorization");

    // No auth header — synthesize anonymous tenant
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

      // Determine system slug from URL if possible (§9.2)
      const url = new URL(req.url);
      let systemSlug = "core";
      if (
        url.pathname.startsWith("/api/core/") ||
        url.pathname.startsWith("/api/auth/")
      ) {
        systemSlug = "core";
      } else if (url.pathname.startsWith("/api/public/")) {
        // Public routes: use slug param if present, else "core"
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
      if (isLikelyJwt(token)) {
        // JWT path — tenant-bearing token
        const claims = await verifyTenantToken(token);

        // Check revocation
        if (claims.jti && (await isJtiRevoked(claims.jti))) {
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

        // Populate context
        const authCtx = buildContext(claims);
        ctx.tenant = authCtx.tenant;
        ctx.claims = authCtx.claims;
      } else {
        // Opaque API token path
        const tokenHash = await hashToken(token);
        const apiToken = await findTokenByHash(tokenHash);

        if (!apiToken) {
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

        // Check revokedAt
        if (apiToken.revokedAt) {
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

        // Check expiry (only if not neverExpires)
        if (
          !apiToken.neverExpires &&
          apiToken.expiresAt &&
          new Date(apiToken.expiresAt).getTime() <= Date.now()
        ) {
          return Response.json(
            {
              success: false,
              error: {
                code: "UNAUTHORIZED",
                message: "auth.error.tokenExpired",
              },
            },
            { status: 401 },
          );
        }

        // Enforce CORS for frontend-use tokens
        const claims: TenantClaims = {
          systemId: String(apiToken.tenant?.systemId ?? apiToken.systemId),
          companyId: String(
            apiToken.tenant?.companyId ?? apiToken.companyId,
          ),
          systemSlug: apiToken.tenant?.systemSlug ?? "",
          roles: apiToken.tenant?.roles ?? [],
          permissions: apiToken.tenant?.permissions ?? apiToken.permissions ??
            [],
          actorType: "api_token",
          actorId: String(apiToken.id),
          jti: apiToken.jti ?? "",
          exchangeable: false,
        };

        const corsError = enforceCors(req, claims, apiToken);
        if (corsError) return corsError;

        const authCtx = buildContextFromApiToken(apiToken);
        ctx.tenant = authCtx.tenant;
        ctx.claims = authCtx.claims;
      }

      // Superuser bypasses all role/permission checks
      if (ctx.tenant.roles.includes("superuser")) {
        // Add CORS headers to the response from downstream
        const response = await next();
        if (ctx.claims && ctx.claims.actorType !== "user") {
          const corsHeaders = getCorsHeaders(req, ctx.claims);
          for (const [key, value] of Object.entries(corsHeaders)) {
            response.headers.set(key, value);
          }
        }
        return response;
      }

      // Role check
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

      // Permission check
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

      // Add CORS headers for API tokens with frontendUse
      if (ctx.claims && ctx.claims.actorType !== "user") {
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
