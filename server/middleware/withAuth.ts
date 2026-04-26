import type { Middleware } from "./compose.ts";
import { verifyTenantToken } from "../utils/token.ts";
import { enforceCors, getCorsHeaders } from "../utils/cors.ts";
import {
  ensureActorValidityLoaded,
  isActorValid,
} from "../utils/actor-validity.ts";
import { assertServerOnly } from "../utils/server-only.ts";

assertServerOnly("withAuth");

export function withAuth(
  options?: {
    roles?: string[];
    requireAuthenticated?: boolean;
  },
): Middleware {
  return async (req, ctx, next) => {
    const authHeader = req.headers.get("Authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      const url = new URL(req.url);
      const isAuthRoute = url.pathname.startsWith("/api/auth/");

      if (isAuthRoute) {
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

    let claims;
    try {
      claims = await verifyTenantToken(token);
    } catch {
      return Response.json(
        {
          success: false,
          error: { code: "UNAUTHORIZED", message: "auth.error.invalidToken" },
        },
        { status: 401 },
      );
    }

    // Actor-validity check keyed by tenant record ID (§8.11)
    await ensureActorValidityLoaded(claims.id);
    if (!claims.actorId || !isActorValid(claims.id, claims.actorId)) {
      return Response.json(
        {
          success: false,
          error: { code: "UNAUTHORIZED", message: "auth.error.tokenRevoked" },
        },
        { status: 401 },
      );
    }

    const corsError = enforceCors(req, claims);
    if (corsError) return corsError;

    ctx.tenant = {
      id: claims.id,
      systemId: claims.systemId,
      companyId: claims.companyId,
      systemSlug: claims.systemSlug,
      roles: claims.roles,
    };
    ctx.claims = claims;

    // Superuser bypasses role checks
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

    // Role-based authorization (roles only, no permissions)
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
