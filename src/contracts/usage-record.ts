export interface UsageRecord {
  id: string;
  tenantIds: string[];
  resourceKey: string;
  value: number;
  period: string;
  createdAt: string;
}
