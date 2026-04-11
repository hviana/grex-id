import * as jose from "@panva/jose";
import Core from "./Core.ts";

if (typeof window !== "undefined") {
  throw new Error(
    "server/utils/token.ts must not be imported in client-side code.",
  );
}

function getJwtSecret(): Uint8Array {
  const secret = "dev-secret-change-in-production#23472347239872394";
  return new TextEncoder().encode(secret);
}

export interface TokenPayload {
  userId: string;
  email: string;
  roles: string[];
  companyId?: string;
  systemId?: string;
  permissions?: string[];
}

export async function createSystemToken(
  payload: TokenPayload,
  stayLoggedIn: boolean = false,
): Promise<string> {
  const core = Core.getInstance();
  const expiryMinutes = stayLoggedIn
    ? Number(await core.getSetting("auth.token.expiry.stayLoggedIn.hours")) * 60
    : Number(await core.getSetting("auth.token.expiry.minutes"));

  const jwt = await new jose.SignJWT({
    userId: payload.userId,
    email: payload.email,
    roles: payload.roles,
    companyId: payload.companyId,
    systemId: payload.systemId,
    permissions: payload.permissions,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${expiryMinutes}m`)
    .setIssuer("core")
    .sign(getJwtSecret());

  return jwt;
}

export async function verifySystemToken(token: string): Promise<TokenPayload> {
  const { payload } = await jose.jwtVerify(token, getJwtSecret(), {
    issuer: "core",
  });

  return {
    userId: payload.userId as string,
    email: payload.email as string,
    roles: payload.roles as string[],
    companyId: payload.companyId as string | undefined,
    systemId: payload.systemId as string | undefined,
    permissions: payload.permissions as string[] | undefined,
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
