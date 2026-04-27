import Core from "./Core.ts";
import { assertServerOnly } from "./server-only.ts";

assertServerOnly("cors.ts");

/**
 * Enforces CORS for non-user actors.
 *
 * Rules:
 * - user sessions ride on the same-origin frontend → no enforcement.
 * - Tokens without frontendDomains → reject browser Origin (server-to-server only).
 * - Tokens with frontendDomains → require Origin and validate against the domain list.
 *
 * All auth data is resolved via Core cache, not from JWT claims.
 */
export function enforceCors(
  req: Request,
  actorType: "user" | "api_token",
  frontendDomains: string[],
): Response | null {
  if (actorType === "user") return null;

  const origin = req.headers.get("Origin");
  const frontendUse = frontendDomains.length > 0;

  if (!frontendUse) {
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

  if (!frontendDomains.includes(origin)) {
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
 * Builds CORS response headers for successful responses from non-user actors.
 */
export function getCorsHeaders(
  req: Request,
  actorType: "user" | "api_token",
  frontendDomains: string[],
): Record<string, string> {
  const origin = req.headers.get("Origin");
  if (!origin || actorType === "user") return {};

  if (frontendDomains.length > 0 && frontendDomains.includes(origin)) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };
  }

  return {};
}
