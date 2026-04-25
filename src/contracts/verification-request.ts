export type VerificationOwnerType = "user" | "lead";

export type VerificationActorType =
  | "user"
  | "lead"
  | "api_token"
  | "connected_app"
  | "system";

export interface VerificationRequestTenantContext {
  companyId?: string;
  systemId?: string;
  systemSlug?: string;
  actorId?: string;
  actorType?: VerificationActorType;
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
  companyId?: string;
  systemId?: string;
  systemSlug?: string;
  actorId?: string;
  actorType?: VerificationActorType;
  createdAt: string;
}
