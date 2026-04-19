export interface Plan {
  id: string;
  name: string;
  description: string;
  systemId: string;
  price: number;
  currency: string;
  recurrenceDays: number;
  benefits: string[];
  permissions: string[];
  entityLimits?: Record<string, number>;
  apiRateLimit: number;
  storageLimitBytes: number;
  fileCacheLimitBytes: number;
  planCredits: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
