import { getDb, rid } from "../connection.ts";
import { paginatedQuery } from "./pagination.ts";
import {
  type FieldEncryptionMode,
  standardizeField,
} from "../../utils/field-standardizer.ts";
import { validateFields } from "../../utils/field-validator.ts";
import {
  checkDuplicates,
  type DeduplicationField,
} from "../../utils/entity-deduplicator.ts";
import { decryptField, decryptFieldOptional } from "../../utils/crypto.ts";
import { assertServerOnly } from "../../utils/server-only.ts";
import type { CursorParams, PaginatedResult } from "@/src/contracts/common";

assertServerOnly("generics");

// ---------------------------------------------------------------------------
// Field processing specification
// ---------------------------------------------------------------------------

export interface FieldSpec {
  /** Database column name. */
  field: string;
  /**
   * Entity name passed to standardizeField / validateField for entity-specific
   * overrides. Omit to use generic field resolution.
   */
  entity?: string;
  /**
   * Whether this field should be checked for duplicates before CREATE / UPDATE.
   * Defaults to false.
   */
  unique?: boolean;
  /**
   * Encryption mode — delegated entirely to `standardizeField`.
   * `standardizeField` returns the final value (ciphertext envelope for
   * `aes-256-gcm`, argon2 hash for `argon2-hash`).  The query builder writes
   * every value as a plain `$binding` — it has no encryption logic.
   *
   * Omit for cleartext storage.
   */
  encryption?: FieldEncryptionMode;
}

// ---------------------------------------------------------------------------
// Tenant isolation specification
// ---------------------------------------------------------------------------

export interface TenantIsolation {
  /** Filter by companyId column. */
  companyId?: string;
  /** Filter by systemId column. */
  systemId?: string;
  /**
   * Filter by a userId column.  The column name in the table may differ from
   * "userId", so the caller specifies it as a mapping:
   * `{ userId: "ownerId" }` means `WHERE ownerId = $actorId`.
   */
  userId?: string;
}

// ---------------------------------------------------------------------------
// Generic list options
// ---------------------------------------------------------------------------

export interface GenericListOptions {
  /** Target SurrealDB table name (e.g. "company", "tag"). */
  table: string;
  /** Fields to SELECT. Defaults to "*". */
  select?: string;
  /** Fields to FETCH (resolve record links). */
  fetch?: string;
  /** Column used as cursor. Defaults to "id". */
  cursorField?: string;
  /** ORDER BY clause. Defaults to "createdAt DESC". */
  orderBy?: string;
  /** FULLTEXT searchable columns (will use `@@` with `$search`). */
  searchFields?: string[];
  /** Extra WHERE conditions appended via AND. */
  extraConditions?: string[];
  /** Extra query bindings merged into the parameterized query. */
  extraBindings?: Record<string, unknown>;
  /**
   * Maximum page size for this entity.  When specified, the effective limit
   * is `min(params.limit, limit)`, capped at 200 by the global clamp.
   */
  limit?: number;
}

// ---------------------------------------------------------------------------
// Generic CRUD options — shared by create / update / delete
// ---------------------------------------------------------------------------

export interface GenericCrudOptions {
  /** Target SurrealDB table name. */
  table: string;
  /**
   * Optional tenant isolation.  When provided, every generated query includes
   * AND-combined equality checks for the specified IDs.  Column names default
   * to `companyId`, `systemId`, and the value of `userId` (used as column
   * name).  Any ID that is omitted or falsy is silently skipped.
   */
  ensureTenant?: TenantIsolation;
  /**
   * Field specifications.  On CREATE / UPDATE the pipeline runs:
   *   standardizeField (includes encryption/hashing) → validateField → checkDuplicates → write
   *
   * Fields present in the data map but absent from this array are written
   * as-is (no standardization / validation / dedup / encryption).
   */
  fields?: FieldSpec[];
  /**
   * Record links to FETCH on the final SELECT.  Defaults to none.
   */
  fetch?: string;
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface ValidationError {
  field: string;
  errors: string[];
}

export interface GenericResult<T> {
  success: boolean;
  data?: T;
  errors?: ValidationError[];
  duplicateFields?: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildTenantConditions(
  isolation: TenantIsolation | undefined,
  bindings: Record<string, unknown>,
): string[] {
  if (!isolation) return [];
  const conditions: string[] = [];
  if (isolation.companyId) {
    conditions.push("companyId = $companyId");
    bindings.companyId = rid(isolation.companyId);
  }
  if (isolation.systemId) {
    conditions.push("systemId = $systemId");
    bindings.systemId = rid(isolation.systemId);
  }
  if (isolation.userId) {
    conditions.push(`${isolation.userId} = $actorId`);
    bindings.actorId = rid(isolation.userId);
  }
  return conditions;
}

// ---------------------------------------------------------------------------
// LIST
// ---------------------------------------------------------------------------

export interface TagFilter {
  /**
   * The column on the entity table that holds `array<record<tag>>`.
   * Defaults to `"tags"`.
   */
  tagsColumn?: string;
  /**
   * Tag names to filter by.  The generated condition is an AND of the tag
   * group, where each tag name is matched via an OR inside a subquery:
   *
   * ```sql
   * <tagsColumn> CONTAINS (
   *   SELECT VALUE id FROM tag
   *   WHERE name = $tagName_N
   *   LIMIT 1
   * )
   * ```
   *
   * An entity must match **all** tag names in the list to be included.
   * Empty array → no tag filter applied.
   */
  tagNames: string[];
}

export async function genericList<T = Record<string, unknown>>(
  opts: GenericListOptions,
  params: CursorParams & {
    search?: string;
    ensureTenant?: TenantIsolation;
    tagFilter?: TagFilter;
  },
): Promise<PaginatedResult<T>> {
  const conditions: string[] = [...(opts.extraConditions ?? [])];
  const bindings: Record<string, unknown> = {
    ...(opts.extraBindings ?? {}),
  };

  if (params.search && opts.searchFields?.length) {
    const searchExpr = opts.searchFields
      .map((f) => `${f} @@ $search`)
      .join(" OR ");
    conditions.push(`(${searchExpr})`);
    bindings.search = params.search;
  }

  if (params.ensureTenant) {
    conditions.push(...buildTenantConditions(params.ensureTenant, bindings));
  }

  if (params.tagFilter && params.tagFilter.tagNames.length > 0) {
    const col = params.tagFilter.tagsColumn ?? "tags";
    for (let i = 0; i < params.tagFilter.tagNames.length; i++) {
      const bindKey = `tagName_${i}`;
      conditions.push(
        `${col} CONTAINS (SELECT VALUE id FROM tag WHERE name = $${bindKey} LIMIT 1)`,
      );
      bindings[bindKey] = params.tagFilter.tagNames[i];
    }
  }

  const effectiveParams: CursorParams = {
    ...params,
    limit: opts.limit != null
      ? Math.min(params.limit, opts.limit)
      : params.limit,
  };

  return paginatedQuery<T>({
    table: opts.table,
    select: opts.select,
    fetch: opts.fetch,
    cursorField: opts.cursorField,
    orderBy: opts.orderBy,
    conditions,
    bindings,
    params: effectiveParams,
  });
}

// ---------------------------------------------------------------------------
// GET BY ID
// ---------------------------------------------------------------------------

export async function genericGetById<T = Record<string, unknown>>(
  opts: GenericCrudOptions,
  id: string,
): Promise<T | null> {
  const db = await getDb();
  let query = `SELECT * FROM ${opts.table} WHERE id = $id`;
  const bindings: Record<string, unknown> = { id: rid(id) };

  if (opts.ensureTenant) {
    const tenantConds = buildTenantConditions(opts.ensureTenant, bindings);
    if (tenantConds.length) query += " AND " + tenantConds.join(" AND ");
  }

  if (opts.fetch) query += ` FETCH ${opts.fetch}`;

  const result = await db.query<[T[]]>(query, bindings);
  return result[0]?.[0] ?? null;
}

// ---------------------------------------------------------------------------
// CREATE
// ---------------------------------------------------------------------------

export async function genericCreate<
  T = Record<string, unknown>,
>(
  opts: GenericCrudOptions,
  data: Record<string, unknown>,
): Promise<GenericResult<T>> {
  // 1. Standardize (includes encryption) & validate
  const fieldSpecs = opts.fields ?? [];

  const processed: Record<string, unknown> = { ...data };

  const validationInput: { field: string; value: unknown }[] = [];
  for (const spec of fieldSpecs) {
    const raw = processed[spec.field];
    if (typeof raw === "string") {
      processed[spec.field] = await standardizeField(
        spec.field,
        raw,
        spec.entity,
        spec.encryption,
      );
    }
    validationInput.push({
      field: spec.field,
      value: processed[spec.field],
    });
  }

  const validationErrors = await validateFields(validationInput);
  if (Object.keys(validationErrors).length > 0) {
    return {
      success: false,
      errors: Object.entries(validationErrors).map(([field, errors]) => ({
        field,
        errors,
      })),
    };
  }

  // 2. Check duplicates on unique fields
  const uniqueFields: DeduplicationField[] = fieldSpecs
    .filter((s) => s.unique)
    .map((s) => ({ field: s.field, value: processed[s.field] }));

  if (uniqueFields.length > 0) {
    const dupResult = await checkDuplicates(opts.table, uniqueFields);
    if (dupResult.isDuplicate) {
      return {
        success: false,
        duplicateFields: dupResult.conflicts.map((c) => c.field),
      };
    }
  }

  // 3. Build and execute CREATE query — all values are plain $bindings
  const db = await getDb();
  const bindings: Record<string, unknown> = {};
  const setClauses: string[] = [];

  for (const [key, value] of Object.entries(processed)) {
    if (value === undefined) continue;
    bindings[key] = value;
    setClauses.push(`${key} = $${key}`);
  }

  if (opts.ensureTenant) {
    if (opts.ensureTenant.companyId) {
      setClauses.push("companyId = $companyId");
    }
    if (opts.ensureTenant.systemId) {
      setClauses.push("systemId = $systemId");
    }
    if (opts.ensureTenant.userId) {
      setClauses.push(`${opts.ensureTenant.userId} = $actorId`);
    }
    buildTenantConditions(opts.ensureTenant, bindings);
  }

  const setClause = setClauses.join(", ");
  let query = `LET $created = CREATE ${opts.table} SET ${setClause};`;

  const fetchClause = opts.fetch ? ` FETCH ${opts.fetch}` : "";
  query += `SELECT * FROM $created[0].id${fetchClause};`;

  const result = await db.query<[unknown, T[]]>(query, bindings);
  return { success: true, data: result[1]?.[0] };
}

// ---------------------------------------------------------------------------
// UPDATE
// ---------------------------------------------------------------------------

export async function genericUpdate<
  T = Record<string, unknown>,
>(
  opts: GenericCrudOptions,
  id: string,
  data: Record<string, unknown>,
): Promise<GenericResult<T>> {
  // 1. Standardize (includes encryption) & validate
  const fieldSpecs = opts.fields ?? [];

  const processed: Record<string, unknown> = { ...data };

  const validationInput: { field: string; value: unknown }[] = [];
  for (const spec of fieldSpecs) {
    if (!(spec.field in processed)) continue;
    const raw = processed[spec.field];
    if (typeof raw === "string") {
      processed[spec.field] = await standardizeField(
        spec.field,
        raw,
        spec.entity,
        spec.encryption,
      );
    }
    validationInput.push({
      field: spec.field,
      value: processed[spec.field],
    });
  }

  if (validationInput.length > 0) {
    const validationErrors = await validateFields(validationInput);
    if (Object.keys(validationErrors).length > 0) {
      return {
        success: false,
        errors: Object.entries(validationErrors).map(([field, errors]) => ({
          field,
          errors,
        })),
      };
    }
  }

  // 2. Check duplicates on unique fields being updated
  const uniqueFields: DeduplicationField[] = fieldSpecs
    .filter((s) => s.unique && s.field in processed)
    .map((s) => ({ field: s.field, value: processed[s.field] }));

  if (uniqueFields.length > 0) {
    const dupResult = await checkDuplicates(opts.table, uniqueFields);
    if (dupResult.isDuplicate) {
      return {
        success: false,
        duplicateFields: dupResult.conflicts.map((c) => c.field),
      };
    }
  }

  // 3. Build and execute UPDATE query — all values are plain $bindings
  const db = await getDb();
  const bindings: Record<string, unknown> = { id: rid(id) };
  const setClauses: string[] = ["updatedAt = time::now()"];

  for (const [key, value] of Object.entries(processed)) {
    if (value === undefined) continue;
    bindings[key] = value;
    setClauses.push(`${key} = $${key}`);
  }

  const whereParts: string[] = ["id = $id"];
  if (opts.ensureTenant) {
    whereParts.push(
      ...buildTenantConditions(opts.ensureTenant, bindings),
    );
  }

  const setClause = setClauses.join(", ");
  const whereClause = whereParts.join(" AND ");
  const fetchClause = opts.fetch ? ` FETCH ${opts.fetch}` : "";

  const query = `UPDATE ${opts.table} SET ${setClause} WHERE ${whereClause}` +
    ` RETURN AFTER${fetchClause};`;

  const result = await db.query<[T[]]>(query, bindings);
  const updated = result[0]?.[0];
  if (!updated) {
    return {
      success: false,
      errors: [{ field: "id", errors: ["common.error.notFound"] }],
    };
  }
  return { success: true, data: updated };
}

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------

export async function genericDelete(
  opts: GenericCrudOptions,
  id: string,
): Promise<{ success: boolean; deleted: boolean }> {
  const db = await getDb();
  const bindings: Record<string, unknown> = { id: rid(id) };

  const whereParts: string[] = ["id = $id"];
  if (opts.ensureTenant) {
    whereParts.push(
      ...buildTenantConditions(opts.ensureTenant, bindings),
    );
  }

  const whereClause = whereParts.join(" AND ");
  const query = `DELETE FROM ${opts.table} WHERE ${whereClause} RETURN id;`;

  const result = await db.query<[{ id: string }[]]>(query, bindings);
  return { success: true, deleted: (result[0]?.length ?? 0) > 0 };
}

// ---------------------------------------------------------------------------
// Convenience: count — same filters as genericList
// ---------------------------------------------------------------------------

export async function genericCount(
  opts: GenericListOptions,
  params: {
    search?: string;
    ensureTenant?: TenantIsolation;
    tagFilter?: TagFilter;
  },
): Promise<number> {
  const db = await getDb();
  const conditions: string[] = [...(opts.extraConditions ?? [])];
  const bindings: Record<string, unknown> = {
    ...(opts.extraBindings ?? {}),
  };

  if (params.search && opts.searchFields?.length) {
    const searchExpr = opts.searchFields
      .map((f) => `${f} @@ $search`)
      .join(" OR ");
    conditions.push(`(${searchExpr})`);
    bindings.search = params.search;
  }

  if (params.ensureTenant) {
    conditions.push(...buildTenantConditions(params.ensureTenant, bindings));
  }

  if (params.tagFilter && params.tagFilter.tagNames.length > 0) {
    const col = params.tagFilter.tagsColumn ?? "tags";
    for (let i = 0; i < params.tagFilter.tagNames.length; i++) {
      const bindKey = `tagName_${i}`;
      conditions.push(
        `${col} CONTAINS (SELECT VALUE id FROM tag WHERE name = $${bindKey} LIMIT 1)`,
      );
      bindings[bindKey] = params.tagFilter.tagNames[i];
    }
  }

  let query = `SELECT count() AS total FROM ${opts.table}`;
  if (conditions.length) query += " WHERE " + conditions.join(" AND ");
  query += " GROUP ALL";

  const result = await db.query<[{ total: number }[]]>(query, bindings);
  return result[0]?.[0]?.total ?? 0;
}

// ---------------------------------------------------------------------------
// DECRYPT — decrypt AES-256-GCM fields from a fetched record
// ---------------------------------------------------------------------------

export interface DecryptFieldSpec {
  /** Database column name holding the ciphertext envelope. */
  field: string;
  /**
   * Whether the column is optional (`TYPE option<string>`). When true, uses
   * `decryptFieldOptional` which returns `undefined` instead of throwing on
   * null/empty. Defaults to false.
   */
  optional?: boolean;
}

export async function genericDecrypt(
  opts: GenericCrudOptions & { decryptFields: DecryptFieldSpec[] },
  id: string,
): Promise<Record<string, string | undefined>> {
  // Fetch only the required columns
  const columns = opts.decryptFields.map((f) => f.field).join(", ");
  const db = await getDb();
  let query = `SELECT ${columns} FROM ${opts.table} WHERE id = $id`;
  const bindings: Record<string, unknown> = { id: rid(id) };

  if (opts.ensureTenant) {
    const tenantConds = buildTenantConditions(opts.ensureTenant, bindings);
    if (tenantConds.length) query += " AND " + tenantConds.join(" AND ");
  }

  const result = await db.query<[Record<string, string>[]]>(query, bindings);
  const row = result[0]?.[0];
  if (!row) return {};

  const decrypted: Record<string, string | undefined> = {};
  for (const spec of opts.decryptFields) {
    const raw: string | undefined = row[spec.field as keyof typeof row];
    decrypted[spec.field] = spec.optional
      ? await decryptFieldOptional(raw)
      : raw
      ? await decryptField(raw)
      : undefined;
  }

  return decrypted;
}

// ---------------------------------------------------------------------------
// VERIFY — compare a plaintext value against a stored argon2 hash
// ---------------------------------------------------------------------------

export async function genericVerify(
  opts: GenericCrudOptions & {
    /** Column storing the argon2 hash. */
    hashField: string;
  },
  id: string,
  plaintext: string,
): Promise<boolean> {
  const db = await getDb();
  let query = `SELECT ${opts.hashField} FROM ${opts.table} WHERE id = $id`;
  const bindings: Record<string, unknown> = { id: rid(id) };

  if (opts.ensureTenant) {
    const tenantConds = buildTenantConditions(opts.ensureTenant, bindings);
    if (tenantConds.length) query += " AND " + tenantConds.join(" AND ");
  }

  const result = await db.query<[Record<string, string>[]]>(query, bindings);
  const row = result[0]?.[0];
  if (!row) return false;

  const hash: string | undefined = row[opts.hashField as keyof typeof row];
  if (!hash) return false;

  const verified = await db.query<[boolean]>(
    "SELECT VALUE crypto::argon2::compare($hash, $plain)",
    { hash, plain: plaintext },
  );
  return verified[0] === true;
}
