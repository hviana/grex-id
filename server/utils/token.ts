import * as jose from "@panva/jose";
import type { Tenant } from "@/src/contracts/tenant";
import Core from "./Core.ts";
import { getCache } from "./cache.ts";
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
 * Creates an identity-only tenant-bearing JWT.
 *
 * Payload carries only identity fields (tenantId + tenant with id, systemId,
 * companyId, actorId). All auth claims are resolved server-side from Core
 * cache at request time.
 */
export async function createTenantToken(
  tenant: Tenant,
  stayLoggedIn: boolean = false,
  expiresAt?: Date,
): Promise<string> {
  const core = Core.getInstance();
  const jwtBuilder = new jose.SignJWT({
    tenantId: tenant.id,
    tenant: {
      id: tenant.id,
      systemId: tenant.systemId,
      companyId: tenant.companyId,
      actorId: tenant.actorId,
    },
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
 * Verifies a JWT and returns the identity-only tenant.
 * All auth claims are resolved from Core cache by the caller.
 */
export async function verifyTenantToken(
  token: string,
): Promise<{ tenant: Tenant }> {
  const { payload } = await jose.jwtVerify(token, await getJwtSecret(), {
    issuer: "core",
  });

  const t = payload.tenant as Tenant;

  const tenant: Tenant = {
    id: t.id ?? (payload.tenantId as string) ?? "",
    systemId: t.systemId,
    companyId: t.companyId,
    actorId: t.actorId,
  };

  return { tenant };
}

/**
 * Cryptographically random 32-byte hex string. Used for non-JWT flows —
 * e.g. verification-request confirmation URLs.
 */
export function generateSecureToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
