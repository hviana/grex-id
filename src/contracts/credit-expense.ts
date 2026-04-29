export interface CreditExpense {
  id: string;
  tenantIds: string[];
  resourceKey: string;
  amount: number;
  count: number;
  day: string;
  createdAt: string;
}
