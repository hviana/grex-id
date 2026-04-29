// ============================================================================
// Display-oriented API token types — consumed by TokensPage.
// Represents the API response shape from GET /api/tokens.
// Distinct from the DB-mirror contract in src/contracts/api-token.ts.
// ============================================================================

import type { ResourceLimitsData } from "./resource-limits";

export interface ApiTokenView {
  id: string;
  name: string;
  description?: string;
  actorType: "app" | "token";
  resourceLimitId?: ResourceLimitsData | null;
  neverExpires?: boolean;
  expiresAt?: string;
  createdAt: string;
  [key: string]: unknown;
}
