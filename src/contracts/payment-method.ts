export interface PaymentMethod {
  id: string;
  tenantIds: string[];
  type: string;
  data: Record<string, unknown>;
  billingAddressId: string;
  isDefault: boolean;
  createdAt: string;
}
