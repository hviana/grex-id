export interface Voucher {
  id: string;
  code: string;
  applicableCompanyIds: string[];
  priceModifier: number;
  permissions: string[];
  entityLimitModifiers?: Record<string, number>;
  apiRateLimitModifier: number;
  storageLimitModifier: number;
  expiresAt?: string;
  createdAt: string;
}
