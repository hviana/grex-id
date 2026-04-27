import { getDb, rid } from "../connection.ts";
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

/**
 * Minimal tenant scope used by generic query helpers. Only the fields that
 * the helpers actually consume are required — `tenantIds CONTAINS $tenantId`,
 * and optionally `systemId`, `companyId`, `actorId` when they are truthy.
 * This lets callers pass a partial tenant (e.g. `{ id: "tenant:xxx" }`).
 */

assertServerOnly("generics");

// ---------------------------------------------------------------------------
// Schema helpers
// ---------------------------------------------------------------------------
//
// `tableHasField` is consulted on every generated query (tenant scoping,
// auto-timestamps, cascade tenant filtering). Because every DB call is a
// remote round-trip, a per-process cache of `INFO FOR TABLE` is essential —
// schemas don't change on hot paths, so the cache is warm after the first
// lookup per table.
// ---------------------------------------------------------------------------

const tableFieldCache = new Map<string, Set<string>>();

async function tableHasField(table: string, field: string): Promise<boolean> {
  if (!tableFieldCache.has(table)) {
    const db = await getDb();
    const result = await db.query<[{ fields: Record<string, unknown> }[]]>(
      `INFO FOR TABLE ${table};`,
    );
    const raw = result[0];
    const info = Array.isArray(raw) ? raw[0] : raw;
    const fields = info?.fields;
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
// Cascade descriptor (shared by read- and delete-cascade flows)
// ---------------------------------------------------------------------------

export interface CascadeChild {
  /** Table to operate on. */
  table: string;
  /**
   * For DELETE cascade (genericDelete): field on the child table that
   * references the parent entity's id, used for orphan-checking and scoped
   * deletion. Default: "tenantId" when the table has it and a tenant is
   * provided.
   */
  parentField?: string;
  /**
   * For READ cascade (genericList / genericGetById): field on THIS (parent)
   * entity that references the child's id (or array of ids). Loaded child(ren)
   * appear in CascadeResult under this exact key — `assigneeId` yields the
   * matching `user` row, `tagIds` yields an array of `tag` rows. Children
   * that fail the tenant access check are silently filtered out.
   */
  sourceField?: string;
  /**
   * For DELETE: whether the child's parentField is an array<record<>>.
   * For READ:   whether the parent's sourceField is an array (e.g. tagIds vs
   * tagId). Drives the SurrealQL projection: scalar refs use `$parent.field`,
   * array refs use `array::flatten($parent.field)`. JS-side distribution
   * still detects via Array.isArray on each parent's value.
   */
  isArray?: boolean;
  /** Nested cascade for deeper traversal (depth-first). */
  children?: CascadeChild[];
}

/**
 * Map of parent source-field name → loaded related entity (or array of
 * entities). Keys correspond to the parent's "xxxId" / "xxxIds" fields.
 * Children that fail tenant access checks are silently dropped: a single-ref
 * field becomes `null`, an array-ref field omits the missing entries.
 */
export type CascadeResult = Record<
  string,
  Record<string, unknown> | Record<string, unknown>[] | null
>;

/** A row optionally augmented with its loaded cascade graph under `_cascade`. */
export type WithCascade<T> = T & { _cascade?: CascadeResult };

// ---------------------------------------------------------------------------
// Generic list options
// ---------------------------------------------------------------------------

export interface GenericListOptions {
  // --- Table configuration ---
  table: string;
  /** SELECT projection (default `*`). */
  select?: string;
  /** SurrealQL FETCH clause for the main row select. */
  fetch?: string;
  /**
   * Field used for cursor-based pagination. Default `"id"`. The cursor value
   * is compared against this field with `>` (ASC) or `<` (DESC). Should be
   * monotonic for stable paging.
   */
  cursorField?: string;
  /**
   * ORDER BY field. Defaults to cursorField when omitted. If you set this to
   * something other than cursorField, you're responsible for ensuring the
   * cursor still produces stable, non-overlapping pages.
   */
  orderBy?: string;
  /** ORDER BY direction. Default `"ASC"`. */
  orderByDirection?: "ASC" | "DESC";
  searchFields?: string[];
  dateRangeField?: string;
  extraConditions?: string[];
  extraBindings?: Record<string, unknown>;
  /**
   * Optional cascade descriptors. When present, related entities referenced
   * by each parent's `sourceField` are loaded (tenant-scoped when applicable)
   * IN THE SAME db.query() round-trip and attached to every row under
   * `_cascade`.
   */
  cascade?: CascadeChild[];

  // --- Request parameters ---
  /** Page size (default 20). */
  limit?: number;
  /** Cursor for pagination (pass nextCursor from previous page). */
  cursor?: string;
  /** Fulltext search string. */
  search?: string;
  /** Tenant for scoping (tenantIds, systemId, companyId, actorId). */
  tenant?: Tenant;
  /** Tag-name filter (AND-combined CONTAINS subqueries). */
  tagFilter?: TagFilter;
  /** Inclusive date range filter. */
  dateRange?: DateRangeFilter;
}

// ---------------------------------------------------------------------------
// Generic CRUD options
// ---------------------------------------------------------------------------

export interface GenericCrudOptions {
  table: string;
  /**
   * When set, every generated query includes AND-combined conditions derived
   * from the Tenant contract fields (id → tenantId, systemId, companyId,
   * actorId). The helper checks which of these columns exist on the table
   * and only emits conditions for those that do. Omit for global (unscoped)
   * operations like core admin lookups.
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
 * - tenant.id        → `tenantIds CONTAINS $tenantId`
 * - tenant.systemId  → `systemId = $tenantSystemId`
 * - tenant.companyId → `companyId = $tenantCompanyId`
 * - tenant.actorId   → `actorId = $tenantActorId`
 *
 * Each condition is only emitted when the target table actually has the
 * relevant column (via the cached `tableHasField`).
 */
async function buildTenantConditions(
  tenant: Tenant,
  table: string,
): Promise<TenantBindings> {
  const conditions: string[] = [];
  const bindings: Record<string, unknown> = {};

  const hasTenantIds = await tableHasField(table, "tenantIds");
  if (hasTenantIds) {
    conditions.push("tenantIds CONTAINS $tenantId");
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
 * Appends Tenant-derived conditions into an existing conditions/bindings
 * pair. Only modifies the arrays in-place when the table has the column.
 *
 * `bindingPrefix` re-namespaces every `$x` placeholder to `$prefix_x` so
 * cascade levels (each scoped to the same tenant against a different child
 * table) can coexist in the same query without colliding on `$tenantId`.
 */
async function addTenantConditions(
  tenant: Tenant | undefined,
  table: string,
  conditions: string[],
  bindings: Record<string, unknown>,
  bindingPrefix?: string,
): Promise<void> {
  if (!tenant) return;
  const tb = await buildTenantConditions(tenant, table);
  if (!bindingPrefix) {
    conditions.push(...tb.conditions);
    Object.assign(bindings, tb.bindings);
    return;
  }
  for (const cond of tb.conditions) {
    conditions.push(
      cond.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, `$${bindingPrefix}_$1`),
    );
  }
  for (const [k, v] of Object.entries(tb.bindings)) {
    bindings[`${bindingPrefix}_${k}`] = v;
  }
}

/**
 * Returns tenant-derived SET clause parts for CREATE/UPDATE statements.
 *
 * For `tenantIds` (array field), emits `tenantIds = [$tenantId]` on create.
 * For scalar fields, emits `field = $binding`.
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
    if (cond.startsWith("tenantIds CONTAINS")) {
      setClauses.push("tenantIds = [$tenantId]");
    } else {
      setClauses.push(cond);
    }
  }
  Object.assign(bindings, tb.bindings);
}

// ---------------------------------------------------------------------------
// CASCADE PLANNING (read-side, used by genericList & genericGetById)
// ---------------------------------------------------------------------------
//
// Cascade loads run in the same round-trip as the main query. The `cascade`
// descriptor tree compiles to a chain of `LET` statements that read from the
// previous LET's array projection — no JS-side intermediate fetches.
//
//   LET $__items   = (SELECT * FROM task WHERE ...);
//   LET $cascade0  = SELECT * FROM user WHERE id IN $__items.assigneeId AND ...;
//   LET $cascade1  = SELECT * FROM company WHERE id IN $cascade0.companyId AND ...;
//   LET $cascade2  = SELECT * FROM tag WHERE id IN array::flatten($__items.tagIds) AND ...;
//
// Then a single `RETURN { items, total, cascade0, cascade1, ... }` packages
// everything for one db.query() call. JS-side, `distributeCascade` walks the
// plan tree and attaches each loaded row back onto its parent's `_cascade`.
// ---------------------------------------------------------------------------

interface CascadePlan {
  sourceField: string;
  /** SurrealQL LET variable name (without `$`) — also the RETURN key. */
  varName: string;
  isArray: boolean;
  children: CascadePlan[];
}

interface CascadeBuilder {
  letStatements: string[];
  returnFields: string[];
  bindings: Record<string, unknown>;
  /** Monotonic counter for unique LET vars across all nesting levels. */
  varCounter: { n: number };
}

async function planCascade(
  cascade: CascadeChild[],
  parentVar: string,
  builder: CascadeBuilder,
  tenant: Tenant | undefined,
): Promise<CascadePlan[]> {
  const plans: CascadePlan[] = [];

  for (const child of cascade) {
    const sourceField = child.sourceField;
    if (!sourceField) continue;

    const varName = `cascade${builder.varCounter.n++}`;
    const isArray = child.isArray ?? false;

    // Project the child id source from the parent LET. Array-ref fields need
    // flattening because $items.tagIds is array<array<>>.
    const idSource = isArray
      ? `array::flatten(${parentVar}.${sourceField})`
      : `${parentVar}.${sourceField}`;

    // Tenant-scope this child the same way as everything else, but with a
    // namespaced binding prefix so multiple cascade levels don't fight over
    // the same `$tenantId` placeholder name.
    const condParts: string[] = [`id IN ${idSource}`];
    await addTenantConditions(
      tenant,
      child.table,
      condParts,
      builder.bindings,
      varName,
    );

    builder.letStatements.push(
      `LET $${varName} = SELECT * FROM ${child.table} WHERE ${
        condParts.join(" AND ")
      };`,
    );
    builder.returnFields.push(`${varName}: $${varName}`);

    const nested = child.children?.length
      ? await planCascade(child.children, `$${varName}`, builder, tenant)
      : [];

    plans.push({ sourceField, varName, isArray, children: nested });
  }

  return plans;
}

/**
 * Walks the cascade plan and indexes each loaded child set by id, then for
 * every parent looks up its source-field value(s) and assigns the matched
 * row(s) into `parent._cascade[sourceField]`. Tenant-filtered-out rows are
 * absent from the index, so single refs collapse to `null` and array refs
 * omit the missing entries.
 */
function distributeCascade(
  parents: Record<string, unknown>[],
  cascadeData: Record<string, unknown>,
  plans: CascadePlan[],
): void {
  for (const plan of plans) {
    const loaded = (cascadeData[plan.varName] as Record<string, unknown>[]) ??
      [];
    const byId = new Map<string, Record<string, unknown>>();
    for (const item of loaded) byId.set(stringifyId(item.id), item);

    for (const parent of parents) {
      const v = parent[plan.sourceField];
      const slot =
        ((parent as WithCascade<Record<string, unknown>>)._cascade ??= {});
      if (v == null) {
        slot[plan.sourceField] = plan.isArray ? [] : null;
      } else if (Array.isArray(v)) {
        slot[plan.sourceField] = v
          .map((id) => byId.get(stringifyId(id)))
          .filter((x): x is Record<string, unknown> => x != null);
      } else {
        slot[plan.sourceField] = byId.get(stringifyId(v)) ?? null;
      }
    }

    if (plan.children.length > 0) {
      distributeCascade(loaded, cascadeData, plan.children);
    }
  }
}

/**
 * Coerce a SurrealDB record id (string, RecordId, or `{ tb, id }`) to a
 * stable string key for Map / Set lookups. RecordId object identity isn't
 * reliable across query results, so we always key by canonical string form.
 */
function stringifyId(id: unknown): string {
  if (id == null) return "";
  if (typeof id === "string") return id;
  if (typeof id === "object") {
    const obj = id as { toString?: () => string; tb?: string; id?: unknown };
    if (obj.tb && obj.id != null) return `${obj.tb}:${stringifyId(obj.id)}`;
    if (typeof obj.toString === "function") return obj.toString();
  }
  return String(id);
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

/**
 * Cursor-paginated list with optional cascade-loading of related entities.
 *
 * Everything happens in a SINGLE db.query() round-trip:
 *
 *   LET $__items   = (SELECT … LIMIT N+1);   -- N+1 to detect hasMore
 *   LET $__total   = (SELECT count() … GROUP ALL)[0].c;
 *   LET $cascade0  = SELECT … FROM child0 WHERE id IN $__items.<sourceField> …;
 *   LET $cascade1  = SELECT … FROM child1 WHERE id IN $cascade0.<sourceField> …;
 *   …
 *   RETURN { items: $__items, total: $__total, cascade0: $cascade0, … };
 *
 * Cursor pagination uses `WHERE cursorField > $__cursor` for ASC and `<` for
 * DESC. The returned `nextCursor` is the stringified cursorField value of the
 * last row on the current page; pass it back via opts.cursor for the next
 * page.
 */
export async function genericList<T = Record<string, unknown>>(
  opts: GenericListOptions,
): Promise<PaginatedResult<WithCascade<T>>> {
  const baseConditions: string[] = [...(opts.extraConditions ?? [])];
  const bindings: Record<string, unknown> = { ...(opts.extraBindings ?? {}) };

  // --- Filters that apply to BOTH items and total count -------------------

  if (opts.search && opts.searchFields?.length) {
    const searchExpr = opts.searchFields
      .map((f) => `${f} @@ $search`)
      .join(" OR ");
    baseConditions.push(`(${searchExpr})`);
    bindings.search = opts.search;
  }

  await addTenantConditions(
    opts.tenant,
    opts.table,
    baseConditions,
    bindings,
  );

  if (opts.dateRange && opts.dateRangeField) {
    if (opts.dateRange.start) {
      baseConditions.push(`${opts.dateRangeField} >= $dateRangeStart`);
      bindings.dateRangeStart = opts.dateRange.start;
    }
    if (opts.dateRange.end) {
      baseConditions.push(`${opts.dateRangeField} <= $dateRangeEnd`);
      bindings.dateRangeEnd = opts.dateRange.end;
    }
  }

  if (opts.tagFilter && opts.tagFilter.tagNames.length > 0) {
    const col = opts.tagFilter.tagsColumn ?? "tagIds";
    for (let i = 0; i < opts.tagFilter.tagNames.length; i++) {
      const bindKey = `tagName_${i}`;
      baseConditions.push(
        `${col} CONTAINS (SELECT VALUE id FROM tag WHERE name = $${bindKey} LIMIT 1)`,
      );
      bindings[bindKey] = opts.tagFilter.tagNames[i];
    }
  }

  // --- Pagination (only on items, not on total) ---------------------------

  const cursorField = opts.cursorField ?? "id";
  const direction = opts.orderByDirection ?? "ASC";
  const orderField = opts.orderBy ?? cursorField;
  const limit = Math.max(1, opts.limit ?? 20);

  const itemConditions = [...baseConditions];
  if (opts.cursor) {
    const op = direction === "ASC" ? ">" : "<";
    itemConditions.push(`${cursorField} ${op} $__cursor`);
    bindings.__cursor =
      typeof opts.cursor === "string" && opts.cursor.includes(":")
        ? rid(opts.cursor)
        : opts.cursor;
  }

  const baseWhere = baseConditions.length
    ? ` WHERE ${baseConditions.join(" AND ")}`
    : "";
  const itemWhere = itemConditions.length
    ? ` WHERE ${itemConditions.join(" AND ")}`
    : "";
  const selectFields = opts.select ?? "*";
  const fetchClause = opts.fetch ? ` FETCH ${opts.fetch}` : "";

  // Limit + 1 lets us detect hasMore without a second query.
  const itemsSelect = `SELECT ${selectFields} FROM ${opts.table}${itemWhere}` +
    ` ORDER BY ${orderField}${
      /\b(ASC|DESC)\b/i.test(orderField) ? "" : " " + direction
    } LIMIT ${limit + 1}${fetchClause}`;

  const countSelect =
    `SELECT count() AS c FROM ${opts.table}${baseWhere} GROUP ALL`;

  // --- Cascade plan (contributes its own LETs and RETURN fields) ----------

  const builder: CascadeBuilder = {
    letStatements: [],
    returnFields: [],
    bindings,
    varCounter: { n: 0 },
  };

  const cascadePlans = opts.cascade?.length
    ? await planCascade(opts.cascade, "$__items", builder, opts.tenant)
    : [];

  // --- Assemble and execute as one round-trip -----------------------------

  const cascadeReturn = builder.returnFields.length
    ? ", " + builder.returnFields.join(", ")
    : "";

  const query = [
    `LET $__items = (${itemsSelect});`,
    `LET $__totalRow = (${countSelect});`,
    `LET $__total = IF array::len($__totalRow) > 0 THEN $__totalRow[0].c ELSE 0 END;`,
    ...builder.letStatements,
    `RETURN { items: $__items, total: $__total${cascadeReturn} };`,
  ].join("\n");

  const db = await getDb();
  const result = await db.query<unknown[]>(query, bindings);
  const final = (result[result.length - 1] ?? {}) as {
    items?: Record<string, unknown>[];
    total?: number;
    [key: string]: unknown;
  };

  let items = final.items ?? [];
  const total = final.total ?? 0;

  // Trim the +1 sentinel and compute pagination metadata.
  const hasMore = items.length > limit;
  if (hasMore) items = items.slice(0, limit);

  let nextCursor: string | undefined;
  if (hasMore && items.length > 0) {
    const cv = items[items.length - 1][cursorField];
    if (cv != null) nextCursor = stringifyId(cv);
  }

  if (cascadePlans.length > 0 && items.length > 0) {
    distributeCascade(items, final, cascadePlans);
  }

  return {
    items: items as WithCascade<T>[],
    total,
    hasMore,
    nextCursor,
  } as PaginatedResult<WithCascade<T>>;
}

// ---------------------------------------------------------------------------
// GET BY ID
// ---------------------------------------------------------------------------

/**
 * Single-row read with optional cascade. When cascade is requested, the row
 * fetch and every cascade level run in one db.query() round-trip via the
 * same LET-chain compiler used by genericList.
 */
export async function genericGetById<T = Record<string, unknown>>(
  opts: GenericCrudOptions & { cascade?: CascadeChild[] },
  id: string,
): Promise<WithCascade<T> | null> {
  const db = await getDb();
  const bindings: Record<string, unknown> = { id: rid(id) };
  const conditions = ["id = $id"];

  await addTenantConditions(opts.tenant, opts.table, conditions, bindings);

  const fetchClause = opts.fetch ? ` FETCH ${opts.fetch}` : "";
  const entitySelect =
    `SELECT * FROM ${opts.table} WHERE ${conditions.join(" AND ")}` +
    ` LIMIT 1${fetchClause}`;

  // Fast path: no cascade, plain SELECT.
  if (!opts.cascade?.length) {
    const result = await db.query<[T[]]>(entitySelect, bindings);
    return (result[0]?.[0] as WithCascade<T>) ?? null;
  }

  // Cascade path: compile to one LET-chain query.
  const builder: CascadeBuilder = {
    letStatements: [],
    returnFields: [],
    bindings,
    varCounter: { n: 0 },
  };

  // Plan against `$__entity` (an array of one) so cascade projections like
  // `$__entity.userId` produce a one-element array — same shape the list
  // path sees, no special-casing needed downstream.
  const cascadePlans = await planCascade(
    opts.cascade,
    "$__entity",
    builder,
    opts.tenant,
  );

  const cascadeReturn = builder.returnFields.length
    ? ", " + builder.returnFields.join(", ")
    : "";

  const query = [
    `LET $__entity = (${entitySelect});`,
    ...builder.letStatements,
    `RETURN { entity: $__entity[0]${cascadeReturn} };`,
  ].join("\n");

  const result = await db.query<unknown[]>(query, bindings);
  const final = (result[result.length - 1] ?? {}) as {
    entity?: Record<string, unknown> | null;
    [key: string]: unknown;
  };

  const entity = final.entity ?? null;
  if (!entity) return null;

  if (cascadePlans.length > 0) {
    distributeCascade([entity], final, cascadePlans);
  }

  return entity as WithCascade<T>;
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
 * (tenantIds, systemId, companyId, actorId) that exist on the table.
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
  const query = `UPDATE ${table} SET ${setClause} WHERE id = $id RETURN AFTER;`;

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

export interface GenericDeleteResult {
  success: boolean;
  /** True when the root entity was actually hard-deleted. */
  deleted: boolean;
  /** True when the entity was dissociated but still referenced elsewhere. */
  orphaned: boolean;
  /** Tables that were cascade-deleted (only when hard-deleted). */
  cascaded?: string[];
}

/**
 * genericDelete implements the dissociate → orphan-check → hard-delete cycle:
 *
 * 1. If the table has `tenantIds` and a tenant is provided:
 *    a. Dissociate — remove this tenant from the entity's tenantIds array.
 *    b. Orphan-check — query whether any other row still references the
 *       entity through child cascade fields or the same table.
 *    c. If still referenced → return { deleted: true, orphaned: true }.
 *    d. If orphaned → hard-delete the entity and cascade through children.
 *
 * 2. If the table has no `tenantIds` or no tenant is provided:
 *    Hard-delete the entity directly with cascade.
 */
export async function genericDelete(
  opts: GenericCrudOptions & { cascade?: CascadeChild[] },
  id: string,
): Promise<GenericDeleteResult> {
  const db = await getDb();
  const entityId = rid(id);
  const bindings: Record<string, unknown> = { id: entityId };
  const hasTenantIds = await tableHasField(opts.table, "tenantIds");
  const tenant = opts.tenant;

  const tenantWhere: string[] = [];
  await addTenantConditions(tenant, opts.table, tenantWhere, bindings);
  const tenantWhereClause = tenantWhere.length
    ? " AND " + tenantWhere.join(" AND ")
    : "";

  if (hasTenantIds && tenant) {
    const dissociateBindings: Record<string, unknown> = { id: entityId };
    const tenantBind = await buildTenantConditions(tenant, opts.table);
    Object.assign(dissociateBindings, tenantBind.bindings);

    const queries: string[] = [
      `UPDATE ${opts.table} SET tenantIds = tenantIds.filter(|x| x != $tenantId) WHERE id = $id${tenantWhereClause};`,
    ];

    const orphanChecks = await buildOrphanChecks(opts.table, id, opts.cascade);
    queries.push(...orphanChecks.queries);

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

async function buildOrphanChecks(
  table: string,
  id: string,
  cascade?: CascadeChild[],
): Promise<{ queries: string[]; condition: string }> {
  const checks: string[] = [];

  if (cascade?.length) {
    for (const child of cascade) {
      const parentField = child.parentField ?? "tenantIds";
      const isArray = child.isArray ?? true;

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

  checks.push(
    `(SELECT count() AS c FROM ${table} WHERE id = $eid GROUP ALL)[0].c = 0`,
  );

  const queries = [
    `LET $eid = ${
      typeof id === "string" && id.includes(":") ? `$id` : `"${id}"`
    };`,
    `LET $isOrphaned = ${checks.join(" AND ")};`,
  ];

  return { queries, condition: "$isOrphaned" };
}

async function buildCascadeStatements(
  cascade: CascadeChild[],
  parentId: string,
): Promise<{ queries: string[]; cascadedTables: string[] }> {
  const queries: string[] = [];
  const cascadedTables: string[] = [];

  for (const child of cascade) {
    const parentField = child.parentField ?? (
      (await tableHasField(child.table, "tenantIds")) ? "tenantIds" : undefined
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
): Promise<number> {
  const db = await getDb();
  const conditions: string[] = [...(opts.extraConditions ?? [])];
  const bindings: Record<string, unknown> = { ...(opts.extraBindings ?? {}) };

  if (opts.search && opts.searchFields?.length) {
    const searchExpr = opts.searchFields
      .map((f) => `${f} @@ $search`)
      .join(" OR ");
    conditions.push(`(${searchExpr})`);
    bindings.search = opts.search;
  }

  await addTenantConditions(opts.tenant, opts.table, conditions, bindings);

  if (opts.dateRange && opts.dateRangeField) {
    if (opts.dateRange.start) {
      conditions.push(`${opts.dateRangeField} >= $dateRangeStart`);
      bindings.dateRangeStart = opts.dateRange.start;
    }
    if (opts.dateRange.end) {
      conditions.push(`${opts.dateRangeField} <= $dateRangeEnd`);
      bindings.dateRangeEnd = opts.dateRange.end;
    }
  }

  if (opts.tagFilter && opts.tagFilter.tagNames.length > 0) {
    const col = opts.tagFilter.tagsColumn ?? "tagIds";
    for (let i = 0; i < opts.tagFilter.tagNames.length; i++) {
      const bindKey = `tagName_${i}`;
      conditions.push(
        `${col} CONTAINS (SELECT VALUE id FROM tag WHERE name = $${bindKey} LIMIT 1)`,
      );
      bindings[bindKey] = opts.tagFilter.tagNames[i];
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

  const query = `SELECT ${columns} FROM ${opts.table} WHERE ${
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

  const query = `SELECT ${opts.hashField} FROM ${opts.table} WHERE ${
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
