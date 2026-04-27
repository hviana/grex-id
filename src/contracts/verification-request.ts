export type VerificationOwnerType = "user" | "lead";

export type VerificationActorType =
  | "user"
  | "lead"
  | "api_token"
  | "system";

export interface VerificationRequestTenantContext {
  tenantIds?: string[];
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
  tenantIds?: string[];
  systemSlug?: string;
  createdAt: string;
}
