import { queryDuplicateChecks } from "../db/queries/deduplication.ts";
import { assertServerOnly } from "./server-only.ts";

assertServerOnly("server/utils/entity-deduplicator.ts");

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

/**
 * Checks whether any existing records in the given entity table match any of
 * the provided field→value pairs. Each pair is checked independently so the
 * result reports exactly which fields conflict.
 *
 * Null/undefined values are silently skipped (useful for optional fields like
 * phone numbers that may not be provided).
 */
export async function checkDuplicates(
  entity: string,
  fields: DeduplicationField[],
  excludeId?: string,
): Promise<DeduplicationResult> {
  const activeFields = fields.filter(
    (f) => f.value !== null && f.value !== undefined,
  );

  if (activeFields.length === 0) {
    return { isDuplicate: false, conflicts: [] };
  }

  const results = await queryDuplicateChecks(entity, activeFields, excludeId);

  const conflicts: DeduplicationConflict[] = [];
  activeFields.forEach((f, i) => {
    const existing = results[i]?.[0];
    if (existing) {
      conflicts.push({
        field: f.field,
        value: f.value,
        existingRecordId: String(existing.id),
      });
    }
  });

  return {
    isDuplicate: conflicts.length > 0,
    conflicts,
  };
}
