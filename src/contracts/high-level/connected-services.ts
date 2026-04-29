// ============================================================================
// Display-oriented connected-service types — consumed by ConnectedServicesPage.
// Represents the API response shape from GET /api/connected-services.
// Distinct from the DB-mirror contract in src/contracts/connected-service.ts.
// ============================================================================

export interface ConnectedServiceView {
  id: string;
  name: string;
  userName?: string;
  createdAt: string;
  [key: string]: unknown;
}
