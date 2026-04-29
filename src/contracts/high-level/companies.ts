// ============================================================================
// Display-oriented company types — consumed by CompanyEditPage.
// Represents the API response shape from GET /api/companies/[id].
// Distinct from the DB-mirror contract in src/contracts/company.ts.
// ============================================================================

export interface CompanyView {
  id: string;
  name: string;
  document: string;
  documentType: string;
  billingAddressId?: {
    street: string;
    number: string;
    complement?: string;
    neighborhood?: string;
    city: string;
    state: string;
    country: string;
    postalCode: string;
  };
}
