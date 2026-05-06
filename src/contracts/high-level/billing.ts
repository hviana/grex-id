// ============================================================================
// Billing query result types (from server/db/queries/billing.ts)
// ============================================================================

export interface BillingGetData {
  subscriptions: Record<string, unknown>[];
  paymentMethods: Record<string, unknown>[];
  creditPurchases: Record<string, unknown>[];
  creditsBalance: number;
  payments?: Record<string, unknown>[];
  paymentsNextCursor?: string | null;
  pendingAsyncPayments: Record<string, unknown>[];
}

export interface PurchaseCreditsResult {
  purchase: Record<string, unknown>;
  activeSubscriptionId: string;
}

export interface VoucherLookupResult {
  voucher: Record<string, unknown> | undefined;
  subscription:
    | {
      planId: string;
      voucherId: string | null;
      remainingOperationCount?: Record<string, number>;
    }
    | undefined;
  oldVoucher:
    | { resourceLimitId?: Record<string, unknown> }
    | undefined;
}

export interface EnableAutoRechargeResult {
  hasDefaultPaymentMethod: boolean;
}

export interface RetryPaymentResult {
  status: "not_found" | "conflict" | "ok";
  subscriptionId?: string;
}

export interface ExpiredPaymentRow {
  id: string;
  tenantIds: string[];
  subscriptionId: string;
  kind: string;
  amount: number;
  currency: string;
}

export interface ExpiredPaymentOwnerInfo {
  owner: { id: string; name: string } | undefined;
  systemInfo: { name: string; slug: string } | undefined;
}

export interface PaymentSubscriptionContext {
  sub:
    | {
      id: string;
      planId: string;
      paymentMethodId: string;
      tenantIds: string[];
      status: string;
      currentPeriodEnd: string;
      voucherId: string | null;
    }
    | undefined;
  plan:
    | {
      price: number;
      recurrenceDays: number;
      currency: string;
      resourceLimitId?: Record<string, unknown>;
    }
    | undefined;
  voucher:
    | { priceModifier: number; resourceLimitId?: Record<string, unknown> }
    | undefined;
  owner: { id: string; name: string } | undefined;
  systemInfo: { name: string; slug: string } | undefined;
  purchaseStatus: string | undefined;
  systemId: string | undefined;
  companyId: string | undefined;
}

export interface AsyncPaymentContext {
  payment:
    | {
      id: string;
      status: string;
      subscriptionId: string;
      tenantIds: string[];
      amount: number;
      currency: string;
      kind: string;
    }
    | undefined;
  sub:
    | {
      id: string;
      planId: string;
      paymentMethodId: string;
      status: string;
      currentPeriodEnd: string;
    }
    | undefined;
  plan:
    | {
      price: number;
      recurrenceDays: number;
      currency: string;
      resourceLimitId?: Record<string, unknown>;
    }
    | undefined;
  voucher:
    | { priceModifier: number; resourceLimitId?: Record<string, unknown> }
    | undefined;
  owner: { id: string; name: string } | undefined;
  systemInfo: { name: string; slug: string } | undefined;
  creditPurchase: { status?: string } | undefined;
  systemId: string | undefined;
  companyId: string | undefined;
}

export interface AutoRechargeContext {
  sub:
    | {
      id: string;
      autoRechargeEnabled: boolean;
      autoRechargeAmount: number;
      autoRechargeInProgress: boolean;
      tenantIds: string[];
    }
    | undefined;
  paymentMethod: { id: string } | undefined;
  owner: { id: string; name: string } | undefined;
  systemInfo: { name: string; slug: string } | undefined;
}
