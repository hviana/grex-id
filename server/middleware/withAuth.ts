import type { Middleware } from "./compose";
import { verifySystemToken } from "../utils/token";

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
      const payload = await verifySystemToken(token);

      ctx.userId = payload.userId;
      ctx.roles = payload.roles;
      ctx.permissions = payload.permissions ?? [];
      if (payload.companyId) ctx.companyId = payload.companyId;
      if (payload.systemId) ctx.systemId = payload.systemId;

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
