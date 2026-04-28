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
  updatedAt?: string;
}

export interface PaymentMethod {
  id: string;
  tenantIds: string[];
  type: string;
  data: Record<string, unknown>;
  billingAddressId: string;
  isDefault: boolean;
  createdAt: string;
}

export interface CreditPurchase {
  id: string;
  tenantIds: string[];
  amount: number;
  paymentMethodId: string;
  status: "pending" | "completed" | "failed" | "expired";
  subscriptionId?: string;
  createdAt: string;
}

export interface Payment {
  id: string;
  tenantIds: string[];
  subscriptionId: string;
  amount: number;
  currency: string;
  kind: "recurring" | "credits" | "auto-recharge";
  status: "pending" | "completed" | "failed" | "expired";
  paymentMethodId: string;
  transactionId?: string;
  invoiceUrl?: string;
  failureReason?: string;
  continuityData?: Record<string, unknown>;
  expiresAt?: string;
  createdAt: string;
}
