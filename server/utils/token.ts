import * as jose from "@panva/jose";
import Core from "./Core.ts";
import { getCache } from "./cache.ts";
import type { Tenant } from "@/src/contracts/tenant.ts";
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
 * Creates the universal tenant-bearing JWT used by every authenticating
 * actor (§8.1). The claims include the full Tenant with `id`, the `actorId`
 * used by the actor-validity cache (§8.11), and — for non-user actors — the
 * CORS policy (`frontendUse`, `frontendDomains`) so `withAuth` does not
 * need a DB read.
 */
export async function createTenantToken(
  claims: Tenant,
  stayLoggedIn: boolean = false,
  expiresAt?: Date,
): Promise<string> {
  const core = Core.getInstance();
  const jwtBuilder = new jose.SignJWT({
    tenantId: claims.id,
    tenant: {
      id: claims.id,
      systemId: claims.systemId,
      companyId: claims.companyId,
      systemSlug: claims.systemSlug,
      roles: claims.roles,
    },
    actorType: claims.actorType,
    actorId: claims.actorId,
    exchangeable: claims.exchangeable,
    frontendUse: claims.frontendUse,
    frontendDomains: claims.frontendDomains,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer("core");

  if (expiresAt) {
    jwtBuilder.setExpirationTime(expiresAt);
  } else {
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
): Promise<Tenant> {
  const { payload } = await jose.jwtVerify(token, await getJwtSecret(), {
    issuer: "core",
  });

  const tenant = payload.tenant as {
    id: string;
    systemId: string;
    companyId: string;
    systemSlug: string;
    roles: string[];
  };

  return {
    id: tenant.id ?? (payload.tenantId as string) ?? "",
    systemId: tenant.systemId,
    companyId: tenant.companyId,
    systemSlug: tenant.systemSlug ?? "core",
    roles: tenant.roles ?? [],
    actorType: payload.actorType as Tenant["actorType"],
    actorId: payload.actorId as string,
    exchangeable: (payload.exchangeable as boolean) ?? false,
    exp: payload.exp,
    frontendUse: payload.frontendUse as boolean | undefined,
    frontendDomains: payload.frontendDomains as string[] | undefined,
  };
}

/**
 * Cryptographically random 32-byte hex string. Used for non-JWT flows —
 * e.g. verification-request confirmation URLs (§5.2).
 */
export function generateSecureToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
