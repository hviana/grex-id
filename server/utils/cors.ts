import type { TenantClaims } from "@/src/contracts/tenant.ts";
import type { ApiToken } from "@/src/contracts/token.ts";

if (typeof window !== "undefined") {
  throw new Error("cors.ts must not be imported in client-side code.");
}

/**
 * Enforces CORS for frontend-use API tokens only.
 * Returns a 403 Response on failure, or null on success.
 *
 * Rules:
 * - ignore tokens with actorType!="api_token"
 * - Tokens with frontendUse=false: reject if browser Origin present (server-to-server only)
 * - Tokens with frontendUse=true: require Origin, validate against frontendDomains
 */
export function enforceCors(
  req: Request,
  claims: TenantClaims,
  apiToken?: ApiToken,
): Response | null {
  const origin = req.headers.get("Origin");

  // others tokens: no CORS enforcement
  if (claims.actorType != "api_token") {
    return null;
  }

  // Non-frontend API tokens / connected-app tokens: reject if browser origin present
  if (!apiToken?.frontendUse) {
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

  // Frontend-use tokens: require Origin and validate against allowed domains
  if (!origin) {
    return Response.json(
      {
        success: false,
        error: { code: "FORBIDDEN", message: "common.error.cors" },
      },
      { status: 403 },
    );
  }

  const allowed = apiToken.frontendDomains ?? [];
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
 * Builds CORS response headers for successful responses from frontend-use tokens.
 */
export function getCorsHeaders(
  req: Request,
  claims: TenantClaims,
  apiToken?: ApiToken,
): Record<string, string> {
  const origin = req.headers.get("Origin");
  if (!origin || claims.actorType === "user") return {};

  if (
    apiToken?.frontendUse && (apiToken.frontendDomains ?? []).includes(origin)
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
