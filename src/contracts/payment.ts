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
