// ============================================================================
// Display-oriented tag types — consumed by TagSearch.
// Represents the API response shape from GET /api/tags.
// Distinct from the DB-mirror contract in src/contracts/tag.ts.
// ============================================================================

export interface TagView {
  id: string;
  name: string;
  color: string;
}
