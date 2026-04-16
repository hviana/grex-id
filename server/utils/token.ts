import * as jose from "@panva/jose";
import Core from "./Core.ts";
import type { Tenant, TenantClaims } from "@/src/contracts/tenant.ts";

if (typeof window !== "undefined") {
  throw new Error(
    "server/utils/token.ts must not be imported in client-side code.",
  );
}

let _cachedSecret: Uint8Array | null = null;

async function getJwtSecret(): Promise<Uint8Array> {
  if (_cachedSecret) return _cachedSecret;
  const core = Core.getInstance();
  const secret = await core.getSetting("auth.jwt.secret");
  if (!secret) {
    throw new Error(
      "[Auth] Missing core setting: auth.jwt.secret. Set it in the Core settings panel.",
    );
  }
  _cachedSecret = new TextEncoder().encode(secret);
  return _cachedSecret;
}

/**
 * Creates a tenant-bearing JWT.
 * All tokens now embed the full Tenant + actor metadata + jti for revocation.
 */
export async function createTenantToken(
  claims: TenantClaims,
  stayLoggedIn: boolean = false,
): Promise<string> {
  const core = Core.getInstance();
  const expiryMinutes = stayLoggedIn
    ? Number(
      await core.getSetting("auth.token.expiry.stayLoggedIn.hours"),
    ) * 60
    : Number(await core.getSetting("auth.token.expiry.minutes"));

  const jwt = await new jose.SignJWT({
    tenant: {
      systemId: claims.systemId,
      companyId: claims.companyId,
      systemSlug: claims.systemSlug,
      roles: claims.roles,
      permissions: claims.permissions,
    },
    actorType: claims.actorType,
    actorId: claims.actorId,
    jti: claims.jti,
    exchangeable: claims.exchangeable,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${expiryMinutes}m`)
    .setIssuer("core")
    .sign(await getJwtSecret());

  return jwt;
}

/**
 * Verifies a tenant-bearing JWT and returns the full claims.
 */
export async function verifyTenantToken(
  token: string,
): Promise<TenantClaims> {
  const { payload } = await jose.jwtVerify(token, await getJwtSecret(), {
    issuer: "core",
  });

  const tenant = payload.tenant as {
    systemId: string;
    companyId: string;
    systemSlug: string;
    roles: string[];
    permissions: string[];
  };

  return {
    systemId: tenant.systemId ?? "0",
    companyId: tenant.companyId ?? "0",
    systemSlug: tenant.systemSlug ?? "core",
    roles: tenant.roles ?? [],
    permissions: tenant.permissions ?? [],
    actorType: (payload.actorType as TenantClaims["actorType"]) ?? "user",
    actorId: (payload.actorId as string) ?? "0",
    jti: (payload.jti as string) ?? "",
    exchangeable: (payload.exchangeable as boolean) ?? false,
  };
}

export function generateSecureToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashToken(token: string): Promise<string> {
  const encoded = new TextEncoder().encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
