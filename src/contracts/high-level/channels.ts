// ============================================================================
// Channel submission contracts — used by auth register, leads, and users
// API routes for parsing submitted entity_channel data.
// ============================================================================

export interface SubmittedChannel {
  type: string;
  value: string;
}
