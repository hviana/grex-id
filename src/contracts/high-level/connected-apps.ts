// ============================================================================
// Display-oriented connected-app types — consumed by ConnectedAppsPage.
// Represents the API response shape from GET /api/connected-apps.
// ============================================================================

import type { ResourceLimitsData } from "./resource-limits";

export interface ConnectedAppView {
  id: string;
  name: string;
  actorType: string;
  resourceLimitId?: ResourceLimitsData | null;
  createdAt: string;
  [key: string]: unknown;
}
