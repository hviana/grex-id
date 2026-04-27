export interface UsageRecord {
  id: string;
  tenantIds: string[]; // references actor + company + system tenant rows
  resourceKey: string;
  value: number;
  period: string;
  createdAt: string;
}

/**
 * Tracks daily credit expenses per resource key.
 * Each resource that consumes credits is identified by an i18n key
 * (e.g. "billing.credits.resource.faceDetection").
 * Daily containers are aggregated to produce monthly totals.
 */
export interface CreditExpense {
  id: string;
  tenantIds: string[]; // references company-system tenant rows
  resourceKey: string;
  amount: number;
  count: number;
  day: string; // "YYYY-MM-DD"
  createdAt: string;
}
