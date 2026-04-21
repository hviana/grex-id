import * as jose from "@panva/jose";
import Core from "./Core.ts";
import { getCache } from "./cache.ts";
import type { Tenant, TenantClaims } from "@/src/contracts/tenant.ts";
import { assertServerOnly } from "./server-only.ts";

assertServerOnly("server/utils/token.ts");

export async function loadJwtSecret(): Promise<Uint8Array> {
  const core = Core.getInstance();
  const secret = await core.getSetting("auth.jwt.secret");
  if (!secret) {
    throw new Error(
      "[Auth] Missing core setting: auth.jwt.secret. Set it in the Core settings panel.",
    );
  }
  return new TextEncoder().encode(secret);
}

async function getJwtSecret(): Promise<Uint8Array> {
  return getCache<Uint8Array>("core", "jwt-secret");
}

/**
 * Creates a tenant-bearing JWT.
 * All tokens now embed the full Tenant + actor metadata + jti for revocation.
 *
 * @param expiresAt - When provided, uses this explicit expiry (for token exchange
 *   lifetime carry-over per §19.11). Otherwise calculates from Core settings.
 */
export async function createTenantToken(
  claims: TenantClaims,
  stayLoggedIn: boolean = false,
  expiresAt?: Date,
): Promise<string> {
  const core = Core.getInstance();
  const jwtBuilder = new jose.SignJWT({
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
    .setIssuer("core");

  if (expiresAt) {
    jwtBuilder.setExpirationTime(expiresAt);
  } else {
    // Setting stores hours for stay-logged-in; convert to total minutes for jose
    const expiryTotalMinutes = stayLoggedIn
      ? Number(
        await core.getSetting("auth.token.expiry.stayLoggedIn.hours"),
      ) * 60
      : Number(await core.getSetting("auth.token.expiry.minutes"));
    jwtBuilder.setExpirationTime(`${expiryTotalMinutes}m`);
  }

  return jwtBuilder.sign(await getJwtSecret());
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
    exp: payload.exp,
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
