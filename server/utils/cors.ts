import type { TenantClaims } from "@/src/contracts/tenant.ts";
import { assertServerOnly } from "./server-only.ts";

assertServerOnly("cors.ts");

/**
 * Enforces CORS for frontend-use API tokens only. Reads `frontendUse` and
 * `frontendDomains` from the JWT claims — no DB touch.
 *
 * Rules:
 * - user-session claims: no CORS enforcement (user sessions always ride on
 *   the same-origin frontend).
 * - Tokens with `frontendUse = false`: reject if browser Origin is present
 *   (server-to-server only).
 * - Tokens with `frontendUse = true`: require Origin and validate against
 *   `frontendDomains`.
 */
export function enforceCors(
  req: Request,
  claims: TenantClaims,
): Response | null {
  if (claims.actorType === "user") return null;

  const origin = req.headers.get("Origin");

  if (!claims.frontendUse) {
    if (origin) {
      return Response.json(
        {
          success: false,
          error: { code: "FORBIDDEN", message: "common.error.cors" },
        },
        { status: 403 },
      );
    }
    return null;
  }

  if (!origin) {
    return Response.json(
      {
        success: false,
        error: { code: "FORBIDDEN", message: "common.error.cors" },
      },
      { status: 403 },
    );
  }

  const allowed = claims.frontendDomains ?? [];
  if (allowed.length === 0 || !allowed.includes(origin)) {
    return Response.json(
      {
        success: false,
        error: { code: "FORBIDDEN", message: "common.error.cors" },
      },
      { status: 403 },
    );
  }

  return null;
}

/**
 * Builds CORS response headers for successful responses from frontend-use
 * tokens.
 */
export function getCorsHeaders(
  req: Request,
  claims: TenantClaims,
): Record<string, string> {
  const origin = req.headers.get("Origin");
  if (!origin || claims.actorType === "user") return {};

  if (
    claims.frontendUse && (claims.frontendDomains ?? []).includes(origin)
  ) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };
  }

  return {};
}
