// ============================================================================
// Terms display types — consumed by TermsEditor.
// Represents the API response shape from GET /api/core/terms.
// ============================================================================

export interface SystemTerms {
  id: string;
  name: string;
  slug: string;
  termsOfService: string | null;
  hasCustomTerms: boolean;
  effectiveTerms: string;
}

export interface TermsData {
  generic: string;
  systems: SystemTerms[];
}
