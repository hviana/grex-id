// ============================================================================
// Display-oriented billing types — consumed by BillingPage and PlanCard.
// These represent API response shapes from /api/billing, distinct from the
// DB-mirror contracts in src/contracts/{plan,subscription,payment,etc.}.ts.
// ============================================================================

import type React from "react";
import type { ResourceLimitsData } from "./resource-limits";

/** Plan as returned by the billing/onboarding/core plan APIs. */
export interface PlanView {
  id: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  recurrenceDays: number;
  resourceLimitId?: ResourceLimitsData | null;
  isActive?: boolean;
  [key: string]: unknown;
}

/** Voucher info FETCH-resolved on a subscription. */
export interface VoucherView {
  id: string;
  name: string;
  priceModifier: number;
  resourceLimitId?: ResourceLimitsData | null;
  expiresAt?: string;
}

/** Subscription as returned by GET /api/billing. */
export interface SubscriptionView {
  id: string;
  planId: string;
  status: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  voucherId: VoucherView | null;
  remainingOperationCount: Record<string, number> | null;
  autoRechargeEnabled: boolean;
  autoRechargeAmount: number;
  retryPaymentInProgress: boolean;
}

/** Payment method as returned by GET /api/billing. */
export interface PaymentMethodView {
  id: string;
  cardMask: string;
  holderName: string;
  isDefault: boolean;
  createdAt: string;
}

/** Credit purchase as returned by GET /api/billing. */
export interface CreditPurchaseView {
  id: string;
  amount: number;
  status: string;
  createdAt: string;
}

/** Payment record as returned by GET /api/billing. */
export interface PaymentRecordView {
  id: string;
  amount: number;
  currency: string;
  kind: string;
  status: string;
  invoiceUrl?: string;
  continuityData?: Record<string, unknown>;
  expiresAt?: string;
  createdAt: string;
  [key: string]: unknown;
}

/** Props for the shared VoucherCard component. */
export interface VoucherCardProps {
  voucher: {
    id: string;
    name: string;
    applicablePlanIds: string[];
    resourceLimitId?: ResourceLimitsData | null;
    expiresAt: string | null;
  };
  onEdit: () => void;
  onDelete: () => Promise<void>;
}

/** Plan option used by the onboarding system page. */
export interface PlanOption {
  id: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  recurrenceDays: number;
  resourceLimitId?: Record<string, unknown> | null;
  isActive: boolean;
  [key: string]: unknown;
}

/** Plan list item used by the core admin plans page. */
export interface PlanItem {
  id: string;
  name: string;
  description: string;
  systemId: string;
  price: number;
  currency: string;
  recurrenceDays: number;
  resourceLimitId?: Record<string, unknown> | null;
  isActive: boolean;
  createdAt: string;
  [key: string]: unknown;
}

/** Voucher list item used by the core admin vouchers page. */
export interface VoucherItem {
  id: string;
  name: string;
  applicableTenantIds: string[];
  applicablePlanIds: string[];
  resourceLimitId?: ResourceLimitsData | null;
  expiresAt: string | null;
  createdAt: string;
  [key: string]: unknown;
}

/** Props for the shared PlanCard component. */
export interface PlanCardProps {
  plan: PlanView;
  variant: "billing" | "onboarding" | "core";
  highlighted?: boolean;
  badges?: React.ReactNode;
  actions?: React.ReactNode;
  voucherPrice?: { original: number; effective: number; currency: string };
  onClick?: () => void;
  systemName?: string;
  systemSlug?: string;
}
