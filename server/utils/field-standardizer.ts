import { assertServerOnly } from "./server-only.ts";

assertServerOnly("server/utils/field-standardizer.ts");

type StandardizerFn = (value: string) => string;

/**
 * Entity+field-specific standardizers override the generic field standardizer.
 * Key format: "entity.field" e.g. "user.email"
 */
const entityFieldStandardizers: Record<string, StandardizerFn> = {};

/**
 * Generic field standardizers applied when no entity-specific override exists.
 * Key format: field name e.g. "email"
 */
const fieldStandardizers: Record<string, StandardizerFn> = {
  email: (value: string) => value.trim().toLowerCase().replace(/\s+/g, ""),

  phone: (value: string) => value.replace(/\D/g, ""),

  name: (value: string) =>
    value
      .trim()
      .replace(/\s+/g, " ")
      .replace(/[<>]/g, ""),

  slug: (value: string) =>
    value
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, ""),

  document: (value: string) => value.replace(/\D/g, ""),
};

/**
 * Standardizes a field value based on the entity and field name.
 *
 * Resolution order:
 * 1. Entity+field specific standardizer (e.g. "user.email")
 * 2. Generic field standardizer (e.g. "email")
 * 3. Default: trim + sanitize angle brackets
 *
 * @param field - The field name (e.g. "email", "phone")
 * @param value - The raw value from the frontend
 * @param entity - Optional entity name (e.g. "user", "lead")
 * @returns The standardized value
 */
export function standardizeField(
  field: string,
  value: string,
  entity?: string,
): string {
  if (entity) {
    const entityKey = `${entity}.${field}`;
    if (entityFieldStandardizers[entityKey]) {
      return entityFieldStandardizers[entityKey](value);
    }
  }

  if (fieldStandardizers[field]) {
    return fieldStandardizers[field](value);
  }

  // Default: trim and remove angle brackets
  return value.trim().replace(/[<>]/g, "");
}

/**
 * Registers a custom standardizer for a specific entity+field combination.
 */
export function registerStandardizer(
  field: string,
  fn: StandardizerFn,
  entity?: string,
): void {
  if (entity) {
    entityFieldStandardizers[`${entity}.${field}`] = fn;
  } else {
    fieldStandardizers[field] = fn;
  }
}
