export interface Plan {
  id: string;
  name: string;
  description: string;
  tenantIds: string[];
  price: number;
  currency: string;
  recurrenceDays: number;
  resourceLimitId: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
