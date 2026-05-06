export interface UsageRecord {
  id: string;
  tenantIds: string[];
  resourceKey: string;
  value: number;
  counts: number;
  period: string;
  createdAt: string;
}
