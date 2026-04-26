export type VerificationOwnerType = "user" | "lead";

export type VerificationActorType =
  | "user"
  | "lead"
  | "api_token"
  | "connected_app"
  | "system";

export interface VerificationRequestTenantContext {
  tenantId?: string;
  systemSlug?: string;
}

export interface VerificationRequest {
  id: string;
  ownerId: string;
  ownerType: VerificationOwnerType;
  actionKey: string;
  token: string;
  expiresAt: string;
  usedAt: string | null;
  payload?: Record<string, unknown> | null;
  tenantId?: string;
  systemSlug?: string;
  createdAt: string;
}
