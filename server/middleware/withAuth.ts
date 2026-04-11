import type { Middleware } from "./compose.ts";
import { hashToken, verifySystemToken } from "../utils/token.ts";
import { findTokenByHash } from "../db/queries/tokens.ts";

function isLikelyJwt(token: string): boolean {
  return token.split(".").length === 3;
}

export function withAuth(
  options?: { roles?: string[]; permissions?: string[] },
): Middleware {
  return async (req, ctx, next) => {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return Response.json(
        {
          success: false,
          error: {
            code: "UNAUTHORIZED",
            message: "Missing or invalid authorization header",
          },
        },
        { status: 401 },
      );
    }

    const token = authHeader.slice(7);

    try {
      if (isLikelyJwt(token)) {
        const payload = await verifySystemToken(token);

        ctx.userId = payload.userId;
        ctx.roles = payload.roles;
        ctx.permissions = payload.permissions ?? [];
        if (payload.companyId) ctx.companyId = payload.companyId;
        if (payload.systemId) ctx.systemId = payload.systemId;
      } else {
        const tokenHash = await hashToken(token);
        const apiToken = await findTokenByHash(tokenHash);
        if (!apiToken) {
          return Response.json(
            {
              success: false,
              error: {
                code: "UNAUTHORIZED",
                message: "Invalid or expired token",
              },
            },
            { status: 401 },
          );
        }

        if (
          apiToken.expiresAt &&
          new Date(apiToken.expiresAt).getTime() <= Date.now()
        ) {
          return Response.json(
            {
              success: false,
              error: {
                code: "UNAUTHORIZED",
                message: "Invalid or expired token",
              },
            },
            { status: 401 },
          );
        }

        ctx.userId = String(apiToken.userId);
        ctx.companyId = String(apiToken.companyId);
        ctx.systemId = String(apiToken.systemId);
        ctx.roles = [];
        ctx.permissions = apiToken.permissions ?? [];
      }

      if (ctx.roles.includes("superuser")) {
        return next();
      }

      if (options?.roles && options.roles.length > 0) {
        const hasRole = options.roles.some((r) => ctx.roles.includes(r));
        if (!hasRole) {
          return Response.json(
            {
              success: false,
              error: { code: "FORBIDDEN", message: "Insufficient role" },
            },
            { status: 403 },
          );
        }
      }

      if (options?.permissions && options.permissions.length > 0) {
        const hasPermission = ctx.permissions.includes("*") ||
          options.permissions.some((p) => ctx.permissions.includes(p));
        if (!hasPermission) {
          return Response.json(
            {
              success: false,
              error: { code: "FORBIDDEN", message: "Insufficient permissions" },
            },
            { status: 403 },
          );
        }
      }

      return next();
    } catch {
      return Response.json(
        {
          success: false,
          error: { code: "UNAUTHORIZED", message: "Invalid or expired token" },
        },
        { status: 401 },
      );
    }
  };
}
