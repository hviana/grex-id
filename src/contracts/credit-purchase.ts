export interface CreditPurchase {
  id: string;
  tenantIds: string[];
  amount: number;
  paymentMethodId: string;
  status: "pending" | "completed" | "failed" | "expired";
  subscriptionId?: string;
  createdAt: string;
}
