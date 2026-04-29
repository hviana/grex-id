export interface Subscription {
  id: string;
  tenantIds: string[];
  planId: string;
  paymentMethodId?: string;
  status: "active" | "past_due" | "cancelled";
  currentPeriodStart: string;
  currentPeriodEnd: string;
  voucherId?: string;
  remainingPlanCredits: number;
  remainingOperationCount?: Record<string, number>;
  creditAlertSent: boolean;
  operationCountAlertSent?: Record<string, boolean>;
  autoRechargeEnabled?: boolean;
  autoRechargeAmount?: number;
  autoRechargeInProgress?: boolean;
  retryPaymentInProgress: boolean;
  createdAt: string;
  updatedAt: string;
}
