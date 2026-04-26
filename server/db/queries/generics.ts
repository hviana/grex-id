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
import type { Tenant } from "@/src/contracts/tenant";

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
   * When set, every generated query includes AND-combined conditions derived
   * from the Tenant contract fields (id → tenantId, systemId, companyId,
   * actorId). The helper automatically checks which of these columns exist on
   * the table and only emits conditions for those that do. Omit for global
   * (unscoped) operations like core admin lookups.
   */
  tenant?: Tenant;
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
// Tenant-aware condition helpers
// ---------------------------------------------------------------------------

interface TenantBindings {
  conditions: string[];
  bindings: Record<string, unknown>;
}

/**
 * Builds AND-combined SurrealQL conditions and bindings from a Tenant contract.
 *
 * For each relevant Tenant field (id, systemId, companyId, actorId), checks
 * whether the target table actually has a matching column and only emits a
 * condition when it does. This makes every generic function tenant-aware
 * without callers needing to know the table schema.
 *
 * - tenant.id  → `tenantId = $tenantId`
 * - tenant.systemId  → `systemId = $tenantSystemId`
 * - tenant.companyId → `companyId = $tenantCompanyId`
 * - tenant.actorId   → `actorId = $tenantActorId`
 */
async function buildTenantConditions(
  tenant: Tenant,
  table: string,
): Promise<TenantBindings> {
  const conditions: string[] = [];
  const bindings: Record<string, unknown> = {};

  const hasTenantId = await tableHasField(table, "tenantId");
  if (hasTenantId) {
    conditions.push("tenantId = $tenantId");
    bindings.tenantId = rid(tenant.id);
  }

  const hasSystemId = await tableHasField(table, "systemId");
  if (hasSystemId && tenant.systemId) {
    conditions.push("systemId = $tenantSystemId");
    bindings.tenantSystemId = rid(tenant.systemId);
  }

  const hasCompanyId = await tableHasField(table, "companyId");
  if (hasCompanyId && tenant.companyId) {
    conditions.push("companyId = $tenantCompanyId");
    bindings.tenantCompanyId = rid(tenant.companyId);
  }

  const hasActorId = await tableHasField(table, "actorId");
  if (hasActorId && tenant.actorId) {
    conditions.push("actorId = $tenantActorId");
    bindings.tenantActorId = rid(tenant.actorId);
  }

  return { conditions, bindings };
}

/**
 * Appends Tenant-derived conditions into an existing conditions/bindings pair.
 * Only modifies the arrays in-place when the table has the corresponding column.
 */
async function addTenantConditions(
  tenant: Tenant | undefined,
  table: string,
  conditions: string[],
  bindings: Record<string, unknown>,
): Promise<void> {
  if (!tenant) return;
  const tb = await buildTenantConditions(tenant, table);
  conditions.push(...tb.conditions);
  Object.assign(bindings, tb.bindings);
}

/**
 * Returns tenant-derived SET clause parts for CREATE/UPDATE statements.
 * Used alongside addTenantConditions for write operations.
 */
async function addTenantSetClauses(
  tenant: Tenant | undefined,
  table: string,
  setClauses: string[],
  bindings: Record<string, unknown>,
): Promise<void> {
  if (!tenant) return;
  const tb = await buildTenantConditions(tenant, table);
  for (const cond of tb.conditions) {
    // Convert "field = $binding" into a SET clause (same syntax)
    setClauses.push(cond);
  }
  Object.assign(bindings, tb.bindings);
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
  tenant?: Tenant;
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

  await addTenantConditions(params.tenant, opts.table, conditions, bindings);

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

  await addTenantConditions(opts.tenant, opts.table, conditions, bindings);

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

  await addTenantSetClauses(opts.tenant, opts.table, setClauses, bindings);

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
  await addTenantConditions(opts.tenant, opts.table, whereParts, bindings);

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
// ASSOCIATE — set tenant-derived fields on an existing entity
// ---------------------------------------------------------------------------

/**
 * Associates an entity with a tenant by setting the tenant-derived columns
 * (tenantId, systemId, companyId, actorId) that exist on the table.
 *
 * Uses the same field mapping as `buildTenantConditions`:
 * - tenant.id      → tenantId
 * - tenant.systemId  → systemId   (only if tenant.systemId is set)
 * - tenant.companyId → companyId  (only if tenant.companyId is set)
 * - tenant.actorId   → actorId    (only if tenant.actorId is set)
 *
 * Columns that don't exist on the table are silently skipped.
 */
export async function genericAssociate(
  table: string,
  id: string,
  tenant: Tenant,
): Promise<GenericResult<Record<string, unknown>>> {
  const db = await getDb();
  const bindings: Record<string, unknown> = { id: rid(id) };
  const setClauses: string[] = [];

  await addTenantSetClauses(tenant, table, setClauses, bindings);

  if (setClauses.length === 0) {
    return {
      success: false,
      errors: [{ field: "tenant", errors: ["common.error.noTenantFields"] }],
    };
  }

  const setClause = setClauses.join(", ");
  const query =
    `UPDATE ${table} SET ${setClause} WHERE id = $id RETURN AFTER;`;

  const result = await db.query<[Record<string, unknown>[]]>(query, bindings);
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
// DELETE (dissociate → orphan-check → hard-delete)
// ---------------------------------------------------------------------------

export interface CascadeChild {
  /** Table to cascade-delete from when the parent is orphaned. */
  table: string;
  /**
   * Field on the child table that references the parent entity's id.
   * Used for orphan-checking and scoped deletion.
   * Default: "tenantId" when the table has it and a tenant is provided.
   */
  parentField?: string;
  /**
   * Whether the child's parentField is an array<record<>>.
   * When true, orphan-check uses CONTAINS and dissociation uses array.filter().
   * When false (default), orphan-check uses = and dissociation sets field = NONE.
   */
  isArray?: boolean;
  /** Nested children for deeper cascading (depth-first). */
  children?: CascadeChild[];
}

export interface GenericDeleteResult {
  success: boolean;
  /** True when the root entity was actually hard-deleted. */
  deleted: boolean;
  /** True when the entity was dissociated from the tenant but still referenced elsewhere. */
  orphaned: boolean;
  /** Tables that were cascade-deleted (only when hard-deleted). */
  cascaded?: string[];
}

/**
 * genericDelete implements the dissociate → orphan-check → hard-delete cycle
 * from §2.4.2:
 *
 * 1. If the table has a `tenantId` column and a tenant is provided:
 *    a. Dissociate — remove the entity's tenantId (set to NONE).
 *    b. Orphan-check — query whether any other row still references the entity.
 *       For tenantId-scoped entities, checks if any row across ALL tenants
 *       still references this entity's id through the relevant parent fields.
 *    c. If still referenced → return { deleted: true, orphaned: true }.
 *       The entity survives, dissociated from this tenant only.
 *    d. If orphaned → hard-delete the entity and cascade through children.
 *
 * 2. If the table has no `tenantId` or no tenant is provided:
 *    Hard-delete the entity directly with cascade.
 */
export async function genericDelete(
  opts: GenericCrudOptions & { cascade?: CascadeChild[] },
  id: string,
): Promise<GenericDeleteResult> {
  const db = await getDb();
  const entityId = rid(id);
  const bindings: Record<string, unknown> = { id: entityId };
  const hasTenantId = await tableHasField(opts.table, "tenantId");
  const tenant = opts.tenant;

  // Build tenant-derived WHERE conditions for scoping the initial lookup
  const tenantWhere: string[] = [];
  await addTenantConditions(tenant, opts.table, tenantWhere, bindings);
  const tenantWhereClause = tenantWhere.length
    ? " AND " + tenantWhere.join(" AND ")
    : "";

  if (hasTenantId && tenant) {
    // ── Path A: tenant-scoped entity → dissociate first ──────────────────
    const dissociateBindings: Record<string, unknown> = { id: entityId };
    const tenantBind = await buildTenantConditions(tenant, opts.table);
    Object.assign(dissociateBindings, tenantBind.bindings);

    const queries: string[] = [
      // Step 1: Dissociate — clear tenantId on the entity matching tenant conditions
      `UPDATE ${opts.table} SET tenantId = NONE WHERE id = $id${tenantWhereClause};`,
    ];

    // Step 2: Orphan-check — is the entity still referenced by any row in any tenant?
    const orphanChecks = await buildOrphanChecks(opts.table, id, opts.cascade);
    queries.push(...orphanChecks.queries);

    // Step 3: Conditional hard-delete with cascade
    const cascadeStatements = await buildCascadeStatements(
      opts.cascade ?? [],
      id,
    );
    const cascadeBlock = cascadeStatements.queries.join("\n");

    queries.push(
      `IF ${orphanChecks.condition} THEN
         ${cascadeBlock}
         DELETE FROM ${opts.table} WHERE id = $id;
       END;`,
    );

    await db.query(queries.join("\n"), { ...bindings, ...dissociateBindings });

    // Verify whether entity was actually hard-deleted
    const checkResult = await db.query<[{ id: string }[]]>(
      `SELECT id FROM ${opts.table} WHERE id = $id LIMIT 1;`,
      { id: entityId },
    );
    const stillExists = (checkResult[0]?.[0]) != null;

    return {
      success: true,
      deleted: true,
      orphaned: stillExists,
      cascaded: stillExists ? undefined : cascadeStatements.cascadedTables,
    };
  } else {
    // ── Path B: unscoped entity → hard-delete directly ───────────────────
    const cascadeStatements = await buildCascadeStatements(
      opts.cascade ?? [],
      id,
    );

    const queries: string[] = [
      ...cascadeStatements.queries,
      `DELETE FROM ${opts.table} WHERE id = $id${tenantWhereClause} RETURN id;`,
    ];

    const result = await db.query(queries.join("\n"), bindings);
    const rootResult = result[result.length - 1] as unknown[];
    const deleted = Array.isArray(rootResult) && rootResult.length > 0;

    return {
      success: true,
      deleted,
      orphaned: false,
      cascaded: deleted ? cascadeStatements.cascadedTables : undefined,
    };
  }
}

/**
 * Builds SurrealQL orphan-check queries for an entity.
 * Checks whether any row in any tenant still references the entity
 * through the cascade children's parentField or the entity's own id.
 */
async function buildOrphanChecks(
  table: string,
  id: string,
  cascade?: CascadeChild[],
): Promise<{ queries: string[]; condition: string }> {
  const checks: string[] = [];

  // Check if any row in the same table still has this entity referenced
  // (e.g. other tenants referencing it via foreign keys)
  if (cascade?.length) {
    for (let i = 0; i < cascade.length; i++) {
      const child = cascade[i];
      const parentField = child.parentField ?? "tenantId";
      const isArray = child.isArray ?? false;

      if (isArray) {
        checks.push(
          `(SELECT count() AS c FROM ${child.table} WHERE $eid IN ${parentField} GROUP ALL)[0].c = 0`,
        );
      } else {
        checks.push(
          `(SELECT count() AS c FROM ${child.table} WHERE ${parentField} = $eid GROUP ALL)[0].c = 0`,
        );
      }
    }
  }

  // Also check if any other row in the same table references this id
  // (e.g. composables that might be shared across tenants)
  checks.push(
    `(SELECT count() AS c FROM ${table} WHERE id = $eid GROUP ALL)[0].c = 0`,
  );

  const queries = [
    `LET $eid = ${typeof id === "string" && id.includes(":") ? `$id` : `"${id}"`};`,
    `LET $isOrphaned = ${checks.join(" AND ")};`,
  ];

  return { queries, condition: "$isOrphaned" };
}

/**
 * Builds cascade DELETE statements for all children, depth-first.
 */
async function buildCascadeStatements(
  cascade: CascadeChild[],
  parentId: string,
): Promise<{ queries: string[]; cascadedTables: string[] }> {
  const queries: string[] = [];
  const cascadedTables: string[] = [];

  for (const child of cascade) {
    const parentField = child.parentField ?? (
      (await tableHasField(child.table, "tenantId")) ? "tenantId" : undefined
    );

    if (parentField) {
      if (child.isArray) {
        queries.push(
          `UPDATE ${child.table} SET ${parentField} = ${parentField}.filter(|x| x != $eid);`,
        );
      } else {
        queries.push(
          `DELETE FROM ${child.table} WHERE ${parentField} = $eid;`,
        );
      }
    } else {
      queries.push(`DELETE FROM ${child.table};`);
    }

    cascadedTables.push(child.table);

    if (child.children?.length) {
      const nested = await buildCascadeStatements(child.children, parentId);
      queries.push(...nested.queries);
      cascadedTables.push(...nested.cascadedTables);
    }
  }

  return { queries, cascadedTables };
}

// ---------------------------------------------------------------------------
// Convenience: count
// ---------------------------------------------------------------------------

export async function genericCount(
  opts: GenericListOptions,
  params: {
    search?: string;
    tenant?: Tenant;
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

  await addTenantConditions(params.tenant, opts.table, conditions, bindings);

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

  await addTenantConditions(opts.tenant, opts.table, conditions, bindings);

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

  await addTenantConditions(opts.tenant, opts.table, conditions, bindings);

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
