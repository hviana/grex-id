import type { ResourceLimit } from "./resource-limit.ts";

export interface Plan {
  id: string;
  name: string;
  description: string;
  tenantIds: string[];
  price: number;
  currency: string;
  recurrenceDays: number;
  resourceLimitId?: ResourceLimit;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
