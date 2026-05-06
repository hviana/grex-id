// ============================================================================
// Verification & resource tracking result types
// ============================================================================

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

/** Result from communicationGuard (server/utils/verification-guard.ts). */
export interface CommunicationGuardResult {
  allowed: boolean;
  reason?: "previousNotExpired" | "rateLimited";
  token?: string;
  expiresAt?: Date;
}

/** Result from consumeCredits / credit deduction (server/utils/resource-tracker.ts).
 *  Wraps the detailed queryCreditExpenses result for callers that only need
 *  success/source and remaining balances. */
export interface CreditDeductionResult {
  success: boolean;
  source: "plan" | "purchased" | "insufficient" | "operationLimit";
  remainingPlanCredits?: number;
  remainingPurchasedCredits?: number;
}
