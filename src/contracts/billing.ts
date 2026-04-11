import type { Address } from "./address.ts";

export interface Subscription {
  id: string;
  companyId: string;
  systemId: string;
  planId: string;
  paymentMethodId?: string;
  status: "active" | "past_due" | "cancelled";
  currentPeriodStart: string;
  currentPeriodEnd: string;
  voucherIds: string[];
  remainingPlanCredits: number;
  creditAlertSent: boolean;
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
