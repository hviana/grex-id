export interface UsageRecord {
  id: string;
  companyId: string;
  systemId: string;
  actorType: "user" | "token" | "connected_app";
  actorId: string;
  resource: string;
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
  companyId: string;
  systemId: string;
  resourceKey: string;
  amount: number;
  day: string; // "YYYY-MM-DD"
  createdAt: string;
}
