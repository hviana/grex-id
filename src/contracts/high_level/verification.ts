// ============================================================================
// Verification & resource tracking result types
// ============================================================================

/** Result from communicationGuard (server/utils/verification-guard.ts). */
export interface CommunicationGuardResult {
  allowed: boolean;
  reason?: "previousNotExpired" | "rateLimited";
  token?: string;
  expiresAt?: Date;
}

/** Result from consumeCredits / credit deduction (server/utils/resource-tracker.ts). */
export interface CreditDeductionResult {
  success: boolean;
  source: "plan" | "purchased" | "insufficient" | "operationLimit";
  remainingPlanCredits?: number;
  remainingPurchasedCredits?: number;
}
