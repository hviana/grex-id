// ============================================================================
// Entity deduplication types (from server/utils/entity-deduplicator.ts)
// ============================================================================

export interface DeduplicationField {
  field: string;
  value: unknown;
}

export interface DeduplicationConflict {
  field: string;
  value: unknown;
  existingRecordId: string;
}

export interface DeduplicationResult {
  isDuplicate: boolean;
  conflicts: DeduplicationConflict[];
}
