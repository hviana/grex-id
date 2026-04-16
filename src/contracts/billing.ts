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
  creditAlertSent: boolean; // one-shot alert mechanism
  autoRechargeEnabled: boolean;
  autoRechargeAmount: number; // cents; 0 when disabled
  autoRechargeInProgress: boolean; // re-entrancy guard
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
  billingAddress: Address;
  isDefault: boolean;
  createdAt: string;
}

export interface CreditPurchase {
  id: string;
  companyId: string;
  systemId: string;
  amount: number;
  paymentMethodId: string;
  status: "pending" | "completed" | "failed";
  createdAt: string;
}
