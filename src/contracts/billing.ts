import type { Address } from "./address.ts";

export interface Subscription {
  id: string;
  companyId: string;
  systemId: string;
  planId: string;
  paymentMethodId?: string; // optional for free plans
  status: "active" | "past_due" | "cancelled";
  currentPeriodStart: string;
  currentPeriodEnd: string;
  voucherId?: string; // single voucher — replaced on re-apply
  remainingPlanCredits: number; // resets on renewal
  remainingOperationCount?: Record<string, number>; // per-resourceKey map; resets on renewal
  creditAlertSent: boolean; // one-shot credit exhaustion alert
  operationCountAlertSent?: Record<string, boolean>; // per-resourceKey one-shot alert map
  autoRechargeEnabled: boolean;
  autoRechargeAmount: number; // cents; 0 when disabled
  autoRechargeInProgress: boolean; // re-entrancy guard
  retryPaymentInProgress: boolean; // re-entrancy guard for retry_payment
  createdAt: string;
}

export interface PaymentMethod {
  id: string;
  companyId: string;
  type: "credit_card";
  cardMask: string;
  cardToken: string;
  holderName: string;
  holderDocument: string;
  billingAddressId: Address;
  isDefault: boolean;
  createdAt: string;
}

export interface CreditPurchase {
  id: string;
  companyId: string;
  systemId: string;
  amount: number;
  paymentMethodId: string;
  status: "pending" | "completed" | "failed" | "expired";
  createdAt: string;
}

export interface Payment {
  id: string;
  companyId: string;
  systemId: string;
  subscriptionId: string;
  amount: number;
  currency: string;
  kind: "recurring" | "credits" | "auto-recharge";
  status: "pending" | "completed" | "failed" | "expired";
  paymentMethodId: string;
  transactionId?: string;
  invoiceUrl?: string;
  failureReason?: string;
  continuityData?: Record<string, any>;
  expiresAt?: string;
  createdAt: string;
}
