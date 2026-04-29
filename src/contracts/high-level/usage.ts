// ============================================================================
// Usage display types — consumed by UsagePage.
// Represents the API response shape from GET /api/usage.
// ============================================================================

import type { CoreCreditExpenseRow } from "./query-results";

export interface UsageData {
  storage: {
    usedBytes: number;
    limitBytes: number;
  };
  cache: {
    usedBytes: number;
    maxBytes: number;
    fileCount: number;
  };
  operationCount: {
    resourceKey: string;
    used: number;
    max: number;
  }[];
  creditExpenses: CoreCreditExpenseRow[];
}
