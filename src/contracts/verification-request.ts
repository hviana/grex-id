import type { VerificationOwnerType } from "./high-level/verification";

export interface VerificationRequest {
  id: string;
  ownerId: string;
  ownerType: VerificationOwnerType;
  actionKey: string;
  token: string;
  payload?: Record<string, unknown> | null;
  expiresAt: string;
  usedAt?: string | null;
  tenantIds?: string[];
  createdAt: string;
}
