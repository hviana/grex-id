import type { Tenant } from "./tenant.ts";

export interface LoginRequest {
  email: string;
  password: string;
  twoFactorCode?: string;
  stayLoggedIn?: boolean;
  botToken: string;
}

export interface LoginResponse {
  systemToken: string;
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
 * Transient auth claims carried in the JWT alongside the canonical Tenant.
 * These are NOT part of the Tenant DB row — they're token-level or resolved
 * from resource_limit via Core cache.
 */
export interface VerifiedAuth {
  roles: string[];
  actorType: "user" | "api_token";
  exchangeable: boolean;
  frontendDomains: string[];
  exp?: number;
}

/**
 * Unified request context — every middleware handler receives this.
 * `tenant` is populated from the bearer token's tenant payload.
 * `auth` carries transient JWT claims (roles, actorType, etc.).
 * Auth routes (`/api/auth/*`) may leave both unset.
 */
export interface RequestContext {
  tenant: Tenant;
  auth?: VerifiedAuth;
}
