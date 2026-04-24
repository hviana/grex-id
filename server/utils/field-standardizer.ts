import { assertServerOnly } from "./server-only.ts";
import { encryptField } from "./crypto.ts";
import { getDb } from "../db/connection.ts";

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
 * Encryption modes supported by `standardizeField`.
 *
 * - `aes-256-gcm` — encrypts via the AES-256-GCM wrapper (§4.7).
 * - `argon2-hash` — hashes via `crypto::argon2::generate` inside SurrealDB.
 *
 * In both cases `standardizeField` returns the final value (ciphertext envelope
 * or argon2 hash string).  The caller writes it as a plain `$binding`.
 */
export type FieldEncryptionMode =
  | "aes-256-gcm"
  | "argon2-hash";

/**
 * Standardizes a field value, then encrypts/hashes if requested.
 *
 * Resolution order for standardization:
 * 1. Entity+field specific standardizer (e.g. "user.email")
 * 2. Generic field standardizer (e.g. "email")
 * 3. Default: trim + sanitize angle brackets
 *
 * After standardization, if `encryption` is specified:
 * - `aes-256-gcm` → `encryptField(standardized)`.
 * - `argon2-hash` → `crypto::argon2::generate(standardized)` via SurrealDB.
 *
 * @param field - The field name (e.g. "email", "phone")
 * @param value - The raw value from the frontend
 * @param entity - Optional entity name (e.g. "user", "lead")
 * @param encryption - Optional encryption mode to apply after standardization
 * @returns The standardized (and possibly encrypted/hashed) value
 */
export async function standardizeField(
  field: string,
  value: string,
  entity?: string,
  encryption?: FieldEncryptionMode,
): Promise<string> {
  let result: string;

  if (entity) {
    const entityKey = `${entity}.${field}`;
    if (entityFieldStandardizers[entityKey]) {
      result = entityFieldStandardizers[entityKey](value);
    } else if (fieldStandardizers[field]) {
      result = fieldStandardizers[field](value);
    } else {
      result = value.trim().replace(/[<>]/g, "");
    }
  } else if (fieldStandardizers[field]) {
    result = fieldStandardizers[field](value);
  } else {
    result = value.trim().replace(/[<>]/g, "");
  }

  if (encryption === "aes-256-gcm") {
    return encryptField(result);
  }

  if (encryption === "argon2-hash") {
    const db = await getDb();
    const hashed = await db.query<[string]>(
      "SELECT VALUE crypto::argon2::generate($plain)",
      { plain: result },
    );
    return hashed[0];
  }

  return result;
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
