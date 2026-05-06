export interface Voucher {
  id: string;
  name: string;
  applicableTenantIds: string[];
  applicablePlanIds: string[];
  resourceLimitId: string;
  expiresAt?: string;
  createdAt: string;
}
