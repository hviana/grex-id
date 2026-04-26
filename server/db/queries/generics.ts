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
// Schema helpers
// ---------------------------------------------------------------------------

const tableFieldCache = new Map<string, Set<string>>();

async function tableHasField(table: string, field: string): Promise<boolean> {
  if (!tableFieldCache.has(table)) {
    const db = await getDb();
    const result = await db.query<[{ fields: Record<string, unknown> }[]]>(
      `INFO FOR TABLE ${table};`,
    );
    const fields = result[0]?.[0]?.fields;
    tableFieldCache.set(table, new Set(fields ? Object.keys(fields) : []));
  }
  return tableFieldCache.get(table)!.has(field);
}

// ---------------------------------------------------------------------------
// Field processing specification
// ---------------------------------------------------------------------------

export interface FieldSpec {
  field: string;
  entity?: string;
  unique?: boolean;
  encryption?: FieldEncryptionMode;
}

// ---------------------------------------------------------------------------
// Generic list options
// ---------------------------------------------------------------------------

export interface GenericListOptions {
  table: string;
  select?: string;
  fetch?: string;
  cursorField?: string;
  orderBy?: string;
  searchFields?: string[];
  dateRangeField?: string;
  extraConditions?: string[];
  extraBindings?: Record<string, unknown>;
  limit?: number;
}

// ---------------------------------------------------------------------------
// Generic CRUD options
// ---------------------------------------------------------------------------

export interface GenericCrudOptions {
  table: string;
  /**
   * Universal tenant scope key (tenant.id). When set, every generated query
   * includes `tenantId = $tenantId` for scoping. Omit for global (unscoped)
   * operations like core admin lookups.
   */
  tenantId?: string;
  fields?: FieldSpec[];
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

function addTenantCondition(
  tenantId: string | undefined,
  conditions: string[],
  bindings: Record<string, unknown>,
): void {
  if (tenantId) {
    conditions.push("tenantId = $tenantId");
    bindings.tenantId = rid(tenantId);
  }
}

function addTenantSetClause(
  tenantId: string | undefined,
  setClauses: string[],
  bindings: Record<string, unknown>,
): void {
  if (tenantId) {
    setClauses.push("tenantId = $tenantId");
    bindings.tenantId = rid(tenantId);
  }
}

// ---------------------------------------------------------------------------
// LIST
// ---------------------------------------------------------------------------

export interface TagFilter {
  tagsColumn?: string;
  tagNames: string[];
}

export interface DateRangeFilter {
  start?: string;
  end?: string;
}

export interface GenericListParams extends CursorParams {
  search?: string;
  tenantId?: string;
  tagFilter?: TagFilter;
  dateRange?: DateRangeFilter;
}

export async function genericList<T = Record<string, unknown>>(
  opts: GenericListOptions,
  params: GenericListParams,
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

  addTenantCondition(params.tenantId, conditions, bindings);

  if (params.dateRange && opts.dateRangeField) {
    if (params.dateRange.start) {
      conditions.push(`${opts.dateRangeField} >= $dateRangeStart`);
      bindings.dateRangeStart = params.dateRange.start;
    }
    if (params.dateRange.end) {
      conditions.push(`${opts.dateRangeField} <= $dateRangeEnd`);
      bindings.dateRangeEnd = params.dateRange.end;
    }
  }

  if (params.tagFilter && params.tagFilter.tagNames.length > 0) {
    const col = params.tagFilter.tagsColumn ?? "tagIds";
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
  const bindings: Record<string, unknown> = { id: rid(id) };
  const conditions = ["id = $id"];

  addTenantCondition(opts.tenantId, conditions, bindings);

  let query = `SELECT * FROM ${opts.table} WHERE ${conditions.join(" AND ")}`;
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

  const db = await getDb();
  const bindings: Record<string, unknown> = {};
  const setClauses: string[] = [];

  if (await tableHasField(opts.table, "createdAt")) {
    setClauses.push("createdAt = time::now()");
  }

  for (const [key, value] of Object.entries(processed)) {
    if (value === undefined) continue;
    bindings[key] = value;
    setClauses.push(`${key} = $${key}`);
  }

  addTenantSetClause(opts.tenantId, setClauses, bindings);

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

  const uniqueFields: DeduplicationField[] = fieldSpecs
    .filter((s) => s.unique && s.field in processed)
    .map((s) => ({ field: s.field, value: processed[s.field] }));

  if (uniqueFields.length > 0) {
    const dupResult = await checkDuplicates(opts.table, uniqueFields, id);
    if (dupResult.isDuplicate) {
      return {
        success: false,
        duplicateFields: dupResult.conflicts.map((c) => c.field),
      };
    }
  }

  const db = await getDb();
  const bindings: Record<string, unknown> = { id: rid(id) };
  const setClauses: string[] = [];

  if (await tableHasField(opts.table, "updatedAt")) {
    setClauses.push("updatedAt = time::now()");
  }

  for (const [key, value] of Object.entries(processed)) {
    if (value === undefined) continue;
    bindings[key] = value;
    setClauses.push(`${key} = $${key}`);
  }

  const whereParts: string[] = ["id = $id"];
  addTenantCondition(opts.tenantId, whereParts, bindings);

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
  addTenantCondition(opts.tenantId, whereParts, bindings);

  const whereClause = whereParts.join(" AND ");
  const query = `DELETE FROM ${opts.table} WHERE ${whereClause} RETURN id;`;

  const result = await db.query<[{ id: string }[]]>(query, bindings);
  return { success: true, deleted: (result[0]?.length ?? 0) > 0 };
}

// ---------------------------------------------------------------------------
// Convenience: count
// ---------------------------------------------------------------------------

export async function genericCount(
  opts: GenericListOptions,
  params: {
    search?: string;
    tenantId?: string;
    tagFilter?: TagFilter;
    dateRange?: DateRangeFilter;
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

  addTenantCondition(params.tenantId, conditions, bindings);

  if (params.dateRange && opts.dateRangeField) {
    if (params.dateRange.start) {
      conditions.push(`${opts.dateRangeField} >= $dateRangeStart`);
      bindings.dateRangeStart = params.dateRange.start;
    }
    if (params.dateRange.end) {
      conditions.push(`${opts.dateRangeField} <= $dateRangeEnd`);
      bindings.dateRangeEnd = params.dateRange.end;
    }
  }

  if (params.tagFilter && params.tagFilter.tagNames.length > 0) {
    const col = params.tagFilter.tagsColumn ?? "tagIds";
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
// DECRYPT
// ---------------------------------------------------------------------------

export interface DecryptFieldSpec {
  field: string;
  optional?: boolean;
}

export async function genericDecrypt(
  opts: GenericCrudOptions & { decryptFields: DecryptFieldSpec[] },
  id: string,
): Promise<Record<string, string | undefined>> {
  const columns = opts.decryptFields.map((f) => f.field).join(", ");
  const db = await getDb();
  const bindings: Record<string, unknown> = { id: rid(id) };
  const conditions = ["id = $id"];

  addTenantCondition(opts.tenantId, conditions, bindings);

  let query = `SELECT ${columns} FROM ${opts.table} WHERE ${
    conditions.join(" AND ")
  }`;

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
// VERIFY — compare plaintext against stored argon2 hash
// ---------------------------------------------------------------------------

export async function genericVerify(
  opts: GenericCrudOptions & {
    hashField: string;
  },
  id: string,
  plaintext: string,
): Promise<boolean> {
  const db = await getDb();
  const bindings: Record<string, unknown> = { id: rid(id) };
  const conditions = ["id = $id"];

  addTenantCondition(opts.tenantId, conditions, bindings);

  let query = `SELECT ${opts.hashField} FROM ${opts.table} WHERE ${
    conditions.join(" AND ")
  }`;

  const result = await db.query<[Record<string, string>[]]>(query, bindings);
  const row = result[0]?.[0];
  if (!row) return false;

  const hash: string | undefined = row[opts.hashField as keyof typeof row];
  if (!hash) return false;

  const verified = await db.query<[boolean]>(
    "RETURN crypto::argon2::compare($hash, $plain)",
    { hash, plain: plaintext },
  );
  return verified[0] === true;
}
