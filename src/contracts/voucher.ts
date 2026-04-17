export interface Voucher {
  id: string;
  code: string;
  applicableCompanyIds: string[]; // empty = universal
  applicablePlanIds: string[]; // empty = valid for every plan
  priceModifier: number;
  permissions: string[];
  entityLimitModifiers?: Record<string, number>;
  apiRateLimitModifier: number;
  storageLimitModifier: number;
  creditIncrement: number;
  expiresAt?: string;
  createdAt: string;
}
