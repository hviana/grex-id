import "server-only";

import { encryptField } from "./crypto.ts";
import { argon2Hash } from "../db/queries/crypto.ts";
import type {
  FieldEncryptionMode,
  StandardizerFn,
} from "../../src/contracts/high-level/generics.ts";
import { get } from "./cache.ts";

/**
 * Entity+field-specific standardizers override the generic field standardizer.
 * Key format: "entity.field" e.g. "user.email"
 */
const entityFieldStandardizers: Record<string, StandardizerFn> = {} as Record<
  string,
  StandardizerFn
>;

/**
 * Generic field standardizers applied when no entity-specific override exists.
 * Key format: field name e.g. "email"
 */
const fieldStandardizers: Record<string, StandardizerFn> = {
  email: async (value: string) =>
    value.trim().toLowerCase().replace(/\s+/g, ""),

  phone: async (value: string) => value.replace(/\D/g, ""),

  name: async (value: string) =>
    value
      .trim()
      .replace(/\s+/g, " ")
      .replace(/[<>]/g, ""),

  slug: async (value: string) =>
    value
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, ""),

  document: async (value: string) => value.replace(/\D/g, ""),
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
// FieldEncryptionMode is now in @/src/contracts/high-level/generics

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
      result = await entityFieldStandardizers[entityKey](value);
    } else if (fieldStandardizers[field]) {
      result = await fieldStandardizers[field](value);
    } else {
      result = value.trim().replace(/[<>]/g, "");
    }
  } else if (fieldStandardizers[field]) {
    result = await fieldStandardizers[field](value);
  } else {
    result = value.trim().replace(/[<>]/g, "");
  }

  if (encryption === "aes-256-gcm") {
    return encryptField(result);
  }

  if (encryption === "argon2-hash") {
    return argon2Hash(result);
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

/**
 * Converts an externally-sourced date/datetime string to the DB timezone.
 * Uses the cached timezone offset from the cache API.
 *
 * Input: any parseable date/datetime string (ISO 8601, etc.).
 * Output: ISO 8601 string adjusted to the DB timezone.
 *
 * IMPORTANT: Do NOT call this on values produced by SurrealDB's own time
 * functions (e.g. `time::now()`). Those are already in the DB timezone.
 * Also do NOT call this on values already pre-converted by the frontend's
 * DateSubForm — that would double-convert.
 */
export async function standardizeDateToDb(value: string): Promise<string> {
  const offsetMinutes = (await get(undefined, "timezone")) as number;

  const date = new Date(value);
  if (isNaN(date.getTime())) return value;

  // The DB timezone offset is the offset FROM UTC.
  // e.g. -180 means UTC-3 (the DB is 3 hours behind UTC).
  // We need to adjust the date so it represents the same wall-clock time
  // in the DB timezone as the original value represents in UTC.
  const dbTime = new Date(date.getTime() + offsetMinutes * 60 * 1000);
  return dbTime.toISOString();
}
