import type { Tenant, TenantClaims } from "./tenant.ts";

export interface LoginRequest {
  email: string;
  password: string;
  twoFactorCode?: string;
  stayLoggedIn?: boolean;
  botToken: string;
}

export interface LoginResponse {
  systemToken: string;
  surrealToken: string;
  user: {
    id: string;
    email: string;
    profile: { name: string; avatarUri?: string };
    roles: string[];
  };
}

export interface RegisterRequest {
  email: string;
  password: string;
  confirmPassword: string;
  phone?: string;
  name: string;
  botToken: string;
  termsAccepted?: boolean;
}

export interface VerifyRequest {
  token: string;
}

export interface ForgotPasswordRequest {
  email: string;
  botToken: string;
}

export interface ResetPasswordRequest {
  token: string;
  password: string;
  confirmPassword: string;
}

export interface RefreshRequest {
  systemToken: string;
}

export interface RefreshResponse {
  systemToken: string;
  surrealToken: string;
}

export interface ExchangeRequest {
  companyId: string;
  systemId: string;
}

export interface ExchangeResponse {
  systemToken: string;
  tenant: Tenant;
}

/**
 * Unified request context — every middleware handler receives this.
 * `tenant` is ALWAYS populated (anonymous tenants are synthesized).
 * `claims` is present only for authenticated requests.
 */
export interface RequestContext {
  tenant: Tenant;
  claims?: TenantClaims;
}
