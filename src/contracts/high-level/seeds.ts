// ============================================================================
// Seed contracts — the module shape every seed file must export (§3.5).
// ============================================================================

export interface SeedModule {
  seed: (
    db: import("../../../server/db/connection.ts").Surreal,
  ) => Promise<void>;
}
