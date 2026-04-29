// ============================================================================
// generics.ts — tenant-aware, shared-record-aware generic data-access helpers
//
// Rules this file obeys:
//
// 1. SINGLE-BATCHED-QUERY RULE.
//    Every exported function compiles its work into one multi-statement
//    SurrealQL string and executes it with one `db.query()` call. Control
//    flow inside the batch is done with `LET` variables and `IF ... END;`
//    blocks; never with multiple awaits or Promise.all.
//
// 2. TENANT IS NOW AN ENTITY.
//    Records that are tenant-scoped hold a `tenantIds set<record<tenant>>`.
//    The `Tenant` interface passed by callers is a PARTIAL SPECIFICATION:
//    any subset of { id, actorId, companyId, systemId, groupIds, isOwner }
//    is valid. Specialization order: systemId → companyId → groupIds →
//    actorId (lower = broader scope).
//
//    All tenant fields are optional. A caller spec is matched against a
//    tenant row by checking that every field the caller specified matches.
//    Unspecified fields are unconstrained on the matching side, but for
//    EXACT matching (used by find-or-create) unspecified fields MUST be
//    NONE / empty on the row — we never duplicate tenants.
//
// 3. ACCESS CONTROL.
//    A record is accessible to a caller spec when any of:
//      (a) the record has a tenant that matches the caller spec, OR
//      (b) a `shared_record` grants the required permission to a
//          caller-matching tenant.
//    Tables without a `tenantIds` column skip these checks (global scope).
//
// 4. SHARING.
//    `shared_record` rows carry ownerTenantIds (size 1), accessesTenantIds
//    (the grantees), and permissions ("r" | "w" | "share"). `addShare` and
//    `editShare` enforce that callers only grant permissions they have,
//    and that owners are never silently removed.
// ============================================================================

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
import type { PaginatedResult } from "@/src/contracts/high_level/pagination";

assertServerOnly("generics");

// ============================================================================
// Tenant contract & permission alphabet
// ============================================================================

export interface Tenant {
  id?: string;
  actorId?: string;
  companyId?: string;
  systemId?: string;
  isOwner?: boolean;
  groupIds?: string[];
}

type Permission = "r" | "w" | "share";

// ============================================================================
// Schema-introspection cache (`INFO FOR TABLE` is cached per process)
// ============================================================================

const fieldCache = new Map<string, Set<string>>();

async function tableHasField(table: string, field: string): Promise<boolean> {
  if (!fieldCache.has(table)) {
    const db = await getDb();
    const result = await db.query<[{ fields?: Record<string, unknown> }]>(
      `INFO FOR TABLE ${table};`,
    );
    const raw = result[0];
    const info = Array.isArray(raw) ? raw[0] : raw;
    const fields = info?.fields;
    fieldCache.set(table, new Set(fields ? Object.keys(fields) : []));
  }
  return fieldCache.get(table)!.has(field);
}

// ============================================================================
// Utilities
// ============================================================================

/** Canonicalize a SurrealDB id to a stable string (for Map / Set keys). */
function stringifyId(id: unknown): string {
  if (id == null) return "";
  if (typeof id === "string") return id;
  if (typeof id === "object") {
    const o = id as { toString?: () => string; tb?: string; id?: unknown };
    if (o.tb && o.id != null) return `${o.tb}:${stringifyId(o.id)}`;
    if (typeof o.toString === "function") return o.toString();
  }
  return String(id);
}

/** Internal binding prefix — keeps helper placeholders from colliding. */
const TB = "__t_";

// ============================================================================
// Tenant SQL builders — the core of this file
// ============================================================================

/**
 * Build a SurrealQL subquery that evaluates to a SET of tenant record ids
 * matching the caller's PARTIAL specification.
 *
 * Unspecified fields are unconstrained, so `{ companyId: X }` returns every
 * tenant with `companyId = X` regardless of its other fields. This is the
 * "loose matching" used everywhere except find-or-create.
 *
 * @param suffix Namespace appended to placeholder names so multiple calls
 *               in the same batch don't collide.
 */
function buildCallerTenantsSQL(
  tenant: Tenant | undefined,
  suffix = "",
): { sql: string; bindings: Record<string, unknown> } {
  if (!tenant) return { sql: "[]", bindings: {} };

  const bindings: Record<string, unknown> = {};
  const b = (n: string) => `${TB}${n}${suffix}`;

  // Fast-path: explicit id bypasses the tenant table lookup.
  if (tenant.id) {
    bindings[b("id")] = rid(tenant.id);
    return { sql: `[$${b("id")}]`, bindings };
  }

  const conds: string[] = [];

  if (tenant.actorId) {
    conds.push(`actorId = $${b("aId")}`);
    bindings[b("aId")] = rid(tenant.actorId);
  }
  if (tenant.companyId) {
    conds.push(`companyId = $${b("cId")}`);
    bindings[b("cId")] = rid(tenant.companyId);
  }
  if (tenant.systemId) {
    conds.push(`systemId = $${b("sId")}`);
    bindings[b("sId")] = rid(tenant.systemId);
  }
  if (tenant.groupIds?.length) {
    // Caller wants tenants whose groupIds contain ALL the specified groups.
    conds.push(`groupIds CONTAINSALL $${b("gIds")}`);
    bindings[b("gIds")] = tenant.groupIds.map((g) => rid(g));
  }
  if (tenant.isOwner !== undefined) {
    conds.push(`isOwner = $${b("own")}`);
    bindings[b("own")] = tenant.isOwner;
  }

  const where = conds.length ? ` WHERE ${conds.join(" AND ")}` : "";
  return { sql: `(SELECT VALUE id FROM tenant${where})`, bindings };
}

/**
 * Build LET statements that RESOLVE-OR-CREATE a single tenant matching the
 * spec EXACTLY. Unspecified fields must be NONE / empty on the resulting
 * tenant row. After executing the returned LETs, the variable `$<varName>`
 * holds the tenant id (existing or freshly created).
 *
 * This is the only place we ever create new tenant rows.
 */
function buildResolveOrCreateTenantLET(
  tenant: Tenant,
  varName: string,
): { lets: string[]; bindings: Record<string, unknown> } {
  const bindings: Record<string, unknown> = {};

  // If an explicit id is supplied, we bypass creation entirely.
  if (tenant.id) {
    bindings[`${varName}_idBind`] = rid(tenant.id);
    return {
      lets: [`LET $${varName} = $${varName}_idBind;`],
      bindings,
    };
  }

  // Normalize every slot: specified → value; unspecified → NONE / [].
  bindings[`${varName}_aId`] = tenant.actorId ? rid(tenant.actorId) : null;
  bindings[`${varName}_cId`] = tenant.companyId ? rid(tenant.companyId) : null;
  bindings[`${varName}_sId`] = tenant.systemId ? rid(tenant.systemId) : null;
  bindings[`${varName}_gIds`] = (tenant.groupIds ?? []).map((g) => rid(g));
  bindings[`${varName}_own`] = tenant.isOwner ?? false;

  // Exact-match find. Sets compare canonically in SurrealDB, so `=` on
  // groupIds gives set equality.
  const findSql = `(SELECT VALUE id FROM tenant
      WHERE actorId   = $${varName}_aId
        AND companyId = $${varName}_cId
        AND systemId  = $${varName}_sId
        AND groupIds  = $${varName}_gIds
        AND isOwner   = $${varName}_own
      LIMIT 1)[0]`;

  const createSql = `(CREATE tenant SET
      actorId   = $${varName}_aId,
      companyId = $${varName}_cId,
      systemId  = $${varName}_sId,
      groupIds  = $${varName}_gIds,
      isOwner   = $${varName}_own)[0].id`;

  return {
    lets: [
      `LET $${varName}_found = ${findSql};`,
      `LET $${varName} = IF $${varName}_found != NONE THEN $${varName}_found ELSE ${createSql} END;`,
    ],
    bindings,
  };
}

/**
 * Build a WHERE-clause fragment that authorizes the caller to operate on
 * a row of `table` with the requested `permission`.
 *
 * The fragment is true when EITHER:
 *   (a) the row's `tenantIds` overlaps the caller's matching tenants, or
 *   (b) a `shared_record` exists that names the row, grants `permission`,
 *       and lists a caller-matching tenant among accessesTenantIds.
 *
 * Returns an empty clause for tables that have no `tenantIds` column —
 * those tables are considered globally scoped.
 */
async function buildAccessClause(
  table: string,
  tenant: Tenant | undefined,
  permission: Permission,
  suffix = "",
): Promise<{ clause: string; bindings: Record<string, unknown> }> {
  if (!tenant) return { clause: "", bindings: {} };
  const hasTenantIds = await tableHasField(table, "tenantIds");
  if (!hasTenantIds) return { clause: "", bindings: {} };

  const matching = buildCallerTenantsSQL(tenant, suffix);
  const permKey = `${TB}perm${suffix}`;

  const clause = `(
    tenantIds ANYINSIDE ${matching.sql}
    OR id IN (
      SELECT VALUE recordId FROM shared_record
      WHERE permissions CONTAINS $${permKey}
        AND accessesTenantIds ANYINSIDE ${matching.sql}
    )
  )`;

  return {
    clause,
    bindings: { ...matching.bindings, [permKey]: permission },
  };
}

// ============================================================================
// Public option & result types (surface-compatible with the old API)
// ============================================================================

export interface FieldSpec {
  field: string;
  entity?: string;
  unique?: boolean;
  encryption?: FieldEncryptionMode;
}

export interface CascadeChild {
  /** Child table name. */
  table: string;
  /** For delete cascade: field on the child referencing the parent's id. */
  parentField?: string;
  /** For read cascade: field on the parent referencing the child id(s). */
  sourceField?: string;
  /** Whether the referencing field is a set (true) or scalar (false). */
  isArray?: boolean;
  /** Deeper cascade (depth-first). */
  children?: CascadeChild[];
}

export type CascadeResult = Record<
  string,
  Record<string, unknown> | Record<string, unknown>[] | null
>;
export type WithCascade<T> = T & { _cascade?: CascadeResult };

export interface TagFilter {
  tagsColumn?: string;
  tagNames: string[];
}

export interface DateRangeFilter {
  start?: string;
  end?: string;
}

export interface GenericListOptions {
  table: string;
  select?: string;
  fetch?: string;
  cursorField?: string;
  orderBy?: string;
  orderByDirection?: "ASC" | "DESC";
  searchFields?: string[];
  dateRangeField?: string;
  extraConditions?: string[];
  extraBindings?: Record<string, unknown>;
  cascade?: CascadeChild[];
  limit?: number;
  cursor?: string;
  search?: string;
  tenant?: Tenant;
  tagFilter?: TagFilter;
  dateRange?: DateRangeFilter;
}

export interface GenericCrudOptions {
  table: string;
  tenant?: Tenant;
  fields?: FieldSpec[];
  fetch?: string;
  cascade?: CascadeChild[];
}

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

// ============================================================================
// Read-cascade planner & distributor
// ----------------------------------------------------------------------------
// Given a cascade tree, we emit a chain of LET statements and corresponding
// RETURN fields so the main row fetch + every related fetch all happen in
// one round-trip. Access checks are applied to each cascade level.
// ============================================================================

interface CascadePlan {
  sourceField: string;
  varName: string;
  isArray: boolean;
  children: CascadePlan[];
}

interface CascadeBuilder {
  letStatements: string[];
  returnFields: string[];
  bindings: Record<string, unknown>;
  counter: { n: number };
}

async function planCascade(
  children: CascadeChild[],
  parentVar: string,
  builder: CascadeBuilder,
  caller: Tenant | undefined,
): Promise<CascadePlan[]> {
  const plans: CascadePlan[] = [];

  for (const child of children) {
    const src = child.sourceField;
    if (!src) continue;

    const varName = `__c${builder.counter.n++}`;
    const isArray = child.isArray ?? false;
    const idSource = isArray
      ? `array::flatten(${parentVar}.${src})`
      : `${parentVar}.${src}`;

    // Each cascade level gets its own access clause (w/ its own suffix).
    const access = await buildAccessClause(
      child.table,
      caller,
      "r",
      `_${varName}`,
    );
    Object.assign(builder.bindings, access.bindings);

    const conds = [`id IN ${idSource}`];
    if (access.clause) conds.push(access.clause);

    builder.letStatements.push(
      `LET $${varName} = SELECT * FROM ${child.table} WHERE ${
        conds.join(" AND ")
      };`,
    );
    builder.returnFields.push(`${varName}: $${varName}`);

    const nested = child.children?.length
      ? await planCascade(child.children, `$${varName}`, builder, caller)
      : [];

    plans.push({ sourceField: src, varName, isArray, children: nested });
  }
  return plans;
}

function distributeCascade(
  parents: Record<string, unknown>[],
  data: Record<string, unknown>,
  plans: CascadePlan[],
): void {
  for (const plan of plans) {
    const loaded = (data[plan.varName] as Record<string, unknown>[]) ?? [];
    const byId = new Map<string, Record<string, unknown>>();
    for (const row of loaded) byId.set(stringifyId(row.id), row);

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
      distributeCascade(loaded, data, plan.children);
    }
  }
}

// ============================================================================
// LIST
// ============================================================================

export async function genericList<T = Record<string, unknown>>(
  opts: GenericListOptions,
): Promise<PaginatedResult<WithCascade<T>>> {
  const base: string[] = [...(opts.extraConditions ?? [])];
  const bindings: Record<string, unknown> = { ...(opts.extraBindings ?? {}) };

  // Fulltext search
  if (opts.search && opts.searchFields?.length) {
    base.push(
      `(${opts.searchFields.map((f) => `${f} @@ $search`).join(" OR ")})`,
    );
    bindings.search = opts.search;
  }

  // Access (tenantIds + shared_record) check
  const access = await buildAccessClause(opts.table, opts.tenant, "r");
  if (access.clause) {
    base.push(access.clause);
    Object.assign(bindings, access.bindings);
  }

  // Date range
  if (opts.dateRange && opts.dateRangeField) {
    if (opts.dateRange.start) {
      base.push(`${opts.dateRangeField} >= $dateRangeStart`);
      bindings.dateRangeStart = opts.dateRange.start;
    }
    if (opts.dateRange.end) {
      base.push(`${opts.dateRangeField} <= $dateRangeEnd`);
      bindings.dateRangeEnd = opts.dateRange.end;
    }
  }

  // Tag filter — AND-combined CONTAINS subqueries
  if (opts.tagFilter?.tagNames.length) {
    const col = opts.tagFilter.tagsColumn ?? "tagIds";
    opts.tagFilter.tagNames.forEach((name, i) => {
      const k = `tagName_${i}`;
      base.push(
        `${col} CONTAINS (SELECT VALUE id FROM tag WHERE name = $${k} LIMIT 1)`,
      );
      bindings[k] = name;
    });
  }

  // Pagination setup
  const cursorField = opts.cursorField ?? "id";
  const direction = opts.orderByDirection ?? "ASC";
  const orderField = opts.orderBy ?? cursorField;
  const limit = Math.max(1, opts.limit ?? 20);

  const itemConds = [...base];
  if (opts.cursor) {
    itemConds.push(
      `${cursorField} ${direction === "ASC" ? ">" : "<"} $__cursor`,
    );
    bindings.__cursor = opts.cursor.includes(":")
      ? rid(opts.cursor)
      : opts.cursor;
  }

  const baseWhere = base.length ? ` WHERE ${base.join(" AND ")}` : "";
  const itemWhere = itemConds.length ? ` WHERE ${itemConds.join(" AND ")}` : "";
  const selectFields = opts.select ?? "*";
  const fetchClause = opts.fetch ? ` FETCH ${opts.fetch}` : "";

  // LIMIT + 1 lets us detect hasMore without a second query.
  const itemsSelect = `SELECT ${selectFields} FROM ${opts.table}${itemWhere}` +
    ` ORDER BY ${orderField}${
      /\b(ASC|DESC)\b/i.test(orderField) ? "" : " " + direction
    }` +
    ` LIMIT ${limit + 1}${fetchClause}`;

  const countSelect =
    `SELECT count() AS c FROM ${opts.table}${baseWhere} GROUP ALL`;

  // Cascade LETs (same round-trip)
  const builder: CascadeBuilder = {
    letStatements: [],
    returnFields: [],
    bindings,
    counter: { n: 0 },
  };
  const plans = opts.cascade?.length
    ? await planCascade(opts.cascade, "$__items", builder, opts.tenant)
    : [];

  const cascadeRet = builder.returnFields.length
    ? ", " + builder.returnFields.join(", ")
    : "";

  const query = [
    `LET $__items = (${itemsSelect});`,
    `LET $__totalRow = (${countSelect});`,
    `LET $__total = IF array::len($__totalRow) > 0 THEN $__totalRow[0].c ELSE 0 END;`,
    ...builder.letStatements,
    `RETURN { items: $__items, total: $__total${cascadeRet} };`,
  ].join("\n");

  const db = await getDb();
  const result = await db.query<unknown[]>(query, bindings);
  const final = (result[result.length - 1] ?? {}) as {
    items?: Record<string, unknown>[];
    total?: number;
    [k: string]: unknown;
  };

  let items = final.items ?? [];
  const total = final.total ?? 0;
  const hasMore = items.length > limit;
  if (hasMore) items = items.slice(0, limit);

  let nextCursor: string | undefined;
  if (hasMore && items.length > 0) {
    const cv = items[items.length - 1][cursorField];
    if (cv != null) nextCursor = stringifyId(cv);
  }

  if (plans.length > 0 && items.length > 0) {
    distributeCascade(items, final, plans);
  }

  return {
    items: items as WithCascade<T>[],
    total,
    hasMore,
    nextCursor,
  } as PaginatedResult<WithCascade<T>>;
}

// ============================================================================
// GET BY ID
// ============================================================================

export async function genericGetById<T = Record<string, unknown>>(
  opts: GenericCrudOptions,
  id: string,
): Promise<WithCascade<T> | null> {
  const bindings: Record<string, unknown> = { id: rid(id) };
  const conds = ["id = $id"];

  const access = await buildAccessClause(opts.table, opts.tenant, "r");
  if (access.clause) {
    conds.push(access.clause);
    Object.assign(bindings, access.bindings);
  }

  const fetchClause = opts.fetch ? ` FETCH ${opts.fetch}` : "";
  const entitySelect = `SELECT * FROM ${opts.table} WHERE ${
    conds.join(" AND ")
  } LIMIT 1${fetchClause}`;

  const builder: CascadeBuilder = {
    letStatements: [],
    returnFields: [],
    bindings,
    counter: { n: 0 },
  };
  const plans = opts.cascade?.length
    ? await planCascade(opts.cascade, "$__entity", builder, opts.tenant)
    : [];

  const cascadeRet = builder.returnFields.length
    ? ", " + builder.returnFields.join(", ")
    : "";

  const query = [
    `LET $__entity = (${entitySelect});`,
    ...builder.letStatements,
    `RETURN { entity: $__entity[0]${cascadeRet} };`,
  ].join("\n");

  const db = await getDb();
  const result = await db.query<unknown[]>(query, bindings);
  const final = (result[result.length - 1] ?? {}) as {
    entity?: Record<string, unknown> | null;
    [k: string]: unknown;
  };

  const entity = final.entity ?? null;
  if (!entity) return null;
  if (plans.length > 0) distributeCascade([entity], final, plans);
  return entity as WithCascade<T>;
}

// ============================================================================
// CREATE
// ----------------------------------------------------------------------------
// If the table has `tenantIds`, a tenant must be supplied; we resolve-or-
// create it and seed `tenantIds` with just that one id. Optionally, a list
// of `initialShares` can be passed to spawn shared_record rows in the same
// batch.
// ============================================================================

export async function genericCreate<T = Record<string, unknown>>(
  opts: GenericCrudOptions & {
    /** Optional initial sharing grants created in the same batch. */
    initialShares?: { accessTenant: Tenant; permissions: string[] }[];
  },
  data: Record<string, unknown>,
): Promise<GenericResult<T>> {
  const fieldSpecs = opts.fields ?? [];
  const processed: Record<string, unknown> = { ...data };

  // Standardize + validate declared fields
  const valInput: { field: string; value: unknown }[] = [];
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
    valInput.push({ field: spec.field, value: processed[spec.field] });
  }
  const errs = await validateFields(valInput);
  if (Object.keys(errs).length > 0) {
    return {
      success: false,
      errors: Object.entries(errs).map(([field, e]) => ({ field, errors: e })),
    };
  }

  // Uniqueness pre-check
  const uniqueFields: DeduplicationField[] = fieldSpecs
    .filter((s) => s.unique)
    .map((s) => ({ field: s.field, value: processed[s.field] }));
  if (uniqueFields.length > 0) {
    const dup = await checkDuplicates(opts.table, uniqueFields);
    if (dup.isDuplicate) {
      return {
        success: false,
        duplicateFields: dup.conflicts.map((c) => c.field),
      };
    }
  }

  // Build the batched query
  const bindings: Record<string, unknown> = {};
  const lets: string[] = [];

  const hasTenantIds = await tableHasField(opts.table, "tenantIds");
  let tenantVar: string | null = null;
  if (hasTenantIds && opts.tenant) {
    const tr = buildResolveOrCreateTenantLET(opts.tenant, "__ct");
    lets.push(...tr.lets);
    Object.assign(bindings, tr.bindings);
    tenantVar = "__ct";
  }

  // SET clauses
  const setClauses: string[] = [];
  if (await tableHasField(opts.table, "createdAt")) {
    setClauses.push("createdAt = time::now()");
  }
  if (await tableHasField(opts.table, "updatedAt")) {
    setClauses.push("updatedAt = time::now()");
  }
  for (const [k, v] of Object.entries(processed)) {
    if (v === undefined) continue;
    bindings[k] = v;
    setClauses.push(`${k} = $${k}`);
  }
  if (tenantVar) setClauses.push(`tenantIds = [$${tenantVar}]`);

  lets.push(
    `LET $__created = (CREATE ${opts.table} SET ${setClauses.join(", ")})[0];`,
  );

  // Optional initial shares
  if (opts.initialShares?.length && tenantVar) {
    opts.initialShares.forEach((share, i) => {
      const accessVar = `__as${i}`;
      const tr = buildResolveOrCreateTenantLET(share.accessTenant, accessVar);
      lets.push(...tr.lets);
      Object.assign(bindings, tr.bindings);
      bindings[`__sp${i}`] = share.permissions;
      lets.push(
        `CREATE shared_record SET
           recordId = $__created.id,
           ownerTenantIds = [$${tenantVar}],
           accessesTenantIds = [$${accessVar}],
           permissions = $__sp${i};`,
      );
    });
  }

  const fetchClause = opts.fetch ? ` FETCH ${opts.fetch}` : "";
  lets.push(`LET $__result = (SELECT * FROM $__created.id${fetchClause})[0];`);
  lets.push(`RETURN $__result;`);

  const db = await getDb();
  const result = await db.query<unknown[]>(lets.join("\n"), bindings);
  const created = result[result.length - 1] as T | undefined;

  if (!created) {
    return {
      success: false,
      errors: [{ field: "root", errors: ["common.error.generic"] }],
    };
  }
  return { success: true, data: created };
}

// ============================================================================
// UPDATE
// ============================================================================

export async function genericUpdate<T = Record<string, unknown>>(
  opts: GenericCrudOptions,
  id: string,
  data: Record<string, unknown>,
): Promise<GenericResult<T>> {
  const fieldSpecs = opts.fields ?? [];
  const processed: Record<string, unknown> = { ...data };

  // Standardize + validate fields actually being updated
  const valInput: { field: string; value: unknown }[] = [];
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
    valInput.push({ field: spec.field, value: processed[spec.field] });
  }
  if (valInput.length > 0) {
    const errs = await validateFields(valInput);
    if (Object.keys(errs).length > 0) {
      return {
        success: false,
        errors: Object.entries(errs).map(([field, e]) => ({
          field,
          errors: e,
        })),
      };
    }
  }

  const uniqueFields: DeduplicationField[] = fieldSpecs
    .filter((s) => s.unique && s.field in processed)
    .map((s) => ({ field: s.field, value: processed[s.field] }));
  if (uniqueFields.length > 0) {
    const dup = await checkDuplicates(opts.table, uniqueFields, id);
    if (dup.isDuplicate) {
      return {
        success: false,
        duplicateFields: dup.conflicts.map((c) => c.field),
      };
    }
  }

  const bindings: Record<string, unknown> = { id: rid(id) };
  const setClauses: string[] = [];
  if (await tableHasField(opts.table, "updatedAt")) {
    setClauses.push("updatedAt = time::now()");
  }
  for (const [k, v] of Object.entries(processed)) {
    if (v === undefined) continue;
    bindings[k] = v;
    setClauses.push(`${k} = $${k}`);
  }

  const whereParts = ["id = $id"];
  const access = await buildAccessClause(opts.table, opts.tenant, "w");
  if (access.clause) {
    whereParts.push(access.clause);
    Object.assign(bindings, access.bindings);
  }

  const fetchClause = opts.fetch ? ` FETCH ${opts.fetch}` : "";
  const query = `UPDATE ${opts.table} SET ${setClauses.join(", ")} ` +
    `WHERE ${whereParts.join(" AND ")} RETURN AFTER${fetchClause};`;

  const db = await getDb();
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

// ============================================================================
// ASSOCIATE — add a tenant to entity.tenantIds (additive)
// ----------------------------------------------------------------------------
// The caller (tenant performing the action) must have write access on the
// entity. The tenant to associate is resolve-or-created, then appended to
// `tenantIds` with `+=` so existing memberships are preserved.
// ============================================================================

export async function genericAssociate(
  opts: GenericCrudOptions,
  id: string,
  tenantToAdd: Tenant,
  caller?: Tenant,
): Promise<GenericResult<Record<string, unknown>>> {
  if (!(await tableHasField(opts.table, "tenantIds"))) {
    return {
      success: false,
      errors: [{ field: "tenantIds", errors: ["common.error.notSupported"] }],
    };
  }

  const who = caller ?? tenantToAdd;
  const bindings: Record<string, unknown> = { id: rid(id) };

  // Resolve or create the tenant to add
  const tr = buildResolveOrCreateTenantLET(tenantToAdd, "__at");
  Object.assign(bindings, tr.bindings);

  // Caller must have write access on the entity
  const access = await buildAccessClause(opts.table, who, "w");
  const where = ["id = $id"];
  if (access.clause) {
    where.push(access.clause);
    Object.assign(bindings, access.bindings);
  }

  const query = [
    ...tr.lets,
    `UPDATE ${opts.table} SET tenantIds += $__at ` +
    `WHERE ${where.join(" AND ")} RETURN AFTER;`,
  ].join("\n");

  const db = await getDb();
  const result = await db.query<unknown[]>(query, bindings);
  const rows = result[result.length - 1] as
    | Record<string, unknown>[]
    | undefined;
  const updated = rows?.[0];
  if (!updated) {
    return {
      success: false,
      errors: [{ field: "id", errors: ["common.error.notFound"] }],
    };
  }
  return { success: true, data: updated };
}

// ============================================================================
// DISASSOCIATE — remove all tenants matching a partial spec from entity
// ----------------------------------------------------------------------------
// `tenantToRemove` is interpreted LOOSELY: every entity tenant whose fields
// satisfy the spec is removed. So `{ companyId: X }` removes every tenant
// scoped to that company regardless of actor / system / groups.
// ============================================================================

export async function genericDisassociate(
  opts: GenericCrudOptions,
  id: string,
  tenantToRemove: Tenant,
  caller?: Tenant,
): Promise<GenericResult<Record<string, unknown>>> {
  if (!(await tableHasField(opts.table, "tenantIds"))) {
    return {
      success: false,
      errors: [{ field: "tenantIds", errors: ["common.error.notSupported"] }],
    };
  }

  const who = caller ?? tenantToRemove;
  const bindings: Record<string, unknown> = { id: rid(id) };

  const matching = buildCallerTenantsSQL(tenantToRemove, "_rm");
  Object.assign(bindings, matching.bindings);

  const access = await buildAccessClause(opts.table, who, "w");
  const where = ["id = $id"];
  if (access.clause) {
    where.push(access.clause);
    Object.assign(bindings, access.bindings);
  }

  // `array::complement(a, b)` returns elements in `a` not in `b`.
  const query =
    `UPDATE ${opts.table} SET tenantIds = array::complement(tenantIds, ${matching.sql}) ` +
    `WHERE ${where.join(" AND ")} RETURN AFTER;`;

  const db = await getDb();
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

// ============================================================================
// DELETE — dissociate → orphan-check → cascade delete
// ----------------------------------------------------------------------------
// Semantics (identical to the old code) but everything is batched:
//   1) If the table has `tenantIds` and a caller tenant is supplied, first
//      compute what the tenantIds would look like after removing the
//      caller's matching tenants. If any remain, just write those back and
//      return `{ orphaned: true }` — the record is still referenced.
//   2) Otherwise (or for unscoped tables), cascade-delete children and then
//      delete the root row itself.
// Every cascade level is independently access-checked against the caller.
// ============================================================================

export interface GenericDeleteResult {
  success: boolean;
  deleted: boolean;
  orphaned: boolean;
  cascaded?: string[];
}

export async function genericDelete(
  opts: GenericCrudOptions,
  id: string,
): Promise<GenericDeleteResult> {
  const hasTenantIds = await tableHasField(opts.table, "tenantIds");
  const bindings: Record<string, unknown> = { id: rid(id) };

  const access = await buildAccessClause(opts.table, opts.tenant, "w");
  const where = ["id = $id"];
  if (access.clause) {
    where.push(access.clause);
    Object.assign(bindings, access.bindings);
  }

  const matching = buildCallerTenantsSQL(opts.tenant, "_del");
  Object.assign(bindings, matching.bindings);

  // Build cascade statements (access-checked at each level)
  const cascadeSqls: string[] = [];
  const cascadedTables: string[] = [];
  await buildDeleteCascadeSQL(
    opts.cascade ?? [],
    opts.tenant,
    cascadeSqls,
    cascadedTables,
    bindings,
  );

  let lets: string[];

  if (hasTenantIds && opts.tenant) {
    lets = [
      `LET $__before = (SELECT * FROM ${opts.table} WHERE ${
        where.join(" AND ")
      })[0];`,
      `IF $__before = NONE THEN
         RETURN { deleted: false, orphaned: false }
       END;`,
      `LET $__remaining = array::complement($__before.tenantIds, ${matching.sql});`,
      // If something else still references this row, we only dissociate.
      `IF array::len($__remaining) > 0 THEN
         UPDATE ${opts.table} SET tenantIds = $__remaining WHERE id = $id;
         RETURN { deleted: true, orphaned: true };
       END;`,
      // Otherwise: orphaned — cascade and delete.
      ...cascadeSqls,
      `DELETE FROM ${opts.table} WHERE id = $id;`,
      `RETURN { deleted: true, orphaned: false, cascaded: ${
        JSON.stringify(cascadedTables)
      } };`,
    ];
  } else {
    lets = [
      `LET $__before = (SELECT id FROM ${opts.table} WHERE ${
        where.join(" AND ")
      })[0];`,
      `IF $__before = NONE THEN RETURN { deleted: false, orphaned: false } END;`,
      ...cascadeSqls,
      `DELETE FROM ${opts.table} WHERE id = $id;`,
      `RETURN { deleted: true, orphaned: false, cascaded: ${
        JSON.stringify(cascadedTables)
      } };`,
    ];
  }

  const db = await getDb();
  const result = await db.query<unknown[]>(lets.join("\n"), bindings);
  const ret = result[result.length - 1] as GenericDeleteResult | undefined;
  return {
    success: true,
    deleted: ret?.deleted ?? false,
    orphaned: ret?.orphaned ?? false,
    cascaded: ret?.cascaded,
  };
}

/**
 * Recursively emit access-checked cascade DELETE/UPDATE statements. Each
 * child table is filtered by the caller's access clause, so cascade ops
 * never silently touch rows the caller can't see.
 */
async function buildDeleteCascadeSQL(
  children: CascadeChild[],
  caller: Tenant | undefined,
  out: string[],
  cascadedTables: string[],
  bindings: Record<string, unknown>,
): Promise<void> {
  for (const child of children) {
    const parentField = child.parentField ??
      ((await tableHasField(child.table, "tenantIds"))
        ? "tenantIds"
        : undefined);
    if (!parentField) continue;

    const access = await buildAccessClause(
      child.table,
      caller,
      "w",
      `_cd_${cascadedTables.length}`,
    );
    Object.assign(bindings, access.bindings);
    const extra = access.clause ? ` AND ${access.clause}` : "";

    if (child.isArray) {
      // Array reference → subtract the parent id from each child's set
      out.push(
        `UPDATE ${child.table} SET ${parentField} = array::complement(${parentField}, [$id]) ` +
          `WHERE $id IN ${parentField}${extra};`,
      );
    } else {
      out.push(
        `DELETE FROM ${child.table} WHERE ${parentField} = $id${extra};`,
      );
    }
    cascadedTables.push(child.table);

    if (child.children?.length) {
      await buildDeleteCascadeSQL(
        child.children,
        caller,
        out,
        cascadedTables,
        bindings,
      );
    }
  }
}

// ============================================================================
// COUNT
// ============================================================================

export async function genericCount(opts: GenericListOptions): Promise<number> {
  const conds: string[] = [...(opts.extraConditions ?? [])];
  const bindings: Record<string, unknown> = { ...(opts.extraBindings ?? {}) };

  if (opts.search && opts.searchFields?.length) {
    conds.push(
      `(${opts.searchFields.map((f) => `${f} @@ $search`).join(" OR ")})`,
    );
    bindings.search = opts.search;
  }

  const access = await buildAccessClause(opts.table, opts.tenant, "r");
  if (access.clause) {
    conds.push(access.clause);
    Object.assign(bindings, access.bindings);
  }

  if (opts.dateRange && opts.dateRangeField) {
    if (opts.dateRange.start) {
      conds.push(`${opts.dateRangeField} >= $dateRangeStart`);
      bindings.dateRangeStart = opts.dateRange.start;
    }
    if (opts.dateRange.end) {
      conds.push(`${opts.dateRangeField} <= $dateRangeEnd`);
      bindings.dateRangeEnd = opts.dateRange.end;
    }
  }

  if (opts.tagFilter?.tagNames.length) {
    const col = opts.tagFilter.tagsColumn ?? "tagIds";
    opts.tagFilter.tagNames.forEach((name, i) => {
      const k = `tagName_${i}`;
      conds.push(
        `${col} CONTAINS (SELECT VALUE id FROM tag WHERE name = $${k} LIMIT 1)`,
      );
      bindings[k] = name;
    });
  }

  const where = conds.length ? ` WHERE ${conds.join(" AND ")}` : "";
  const query = `SELECT count() AS total FROM ${opts.table}${where} GROUP ALL;`;
  const db = await getDb();
  const result = await db.query<[{ total: number }[]]>(query, bindings);
  return result[0]?.[0]?.total ?? 0;
}

// ============================================================================
// DECRYPT
// ============================================================================

export interface DecryptFieldSpec {
  field: string;
  optional?: boolean;
}

export async function genericDecrypt(
  opts: GenericCrudOptions & { decryptFields: DecryptFieldSpec[] },
  id: string,
): Promise<Record<string, string | undefined>> {
  const bindings: Record<string, unknown> = { id: rid(id) };
  const conds = ["id = $id"];

  const access = await buildAccessClause(opts.table, opts.tenant, "r");
  if (access.clause) {
    conds.push(access.clause);
    Object.assign(bindings, access.bindings);
  }

  const cols = opts.decryptFields.map((f) => f.field).join(", ");
  const query = `SELECT ${cols} FROM ${opts.table} WHERE ${
    conds.join(" AND ")
  } LIMIT 1;`;

  const db = await getDb();
  const result = await db.query<[Record<string, string>[]]>(query, bindings);
  const row = result[0]?.[0];
  if (!row) return {};

  const out: Record<string, string | undefined> = {};
  for (const spec of opts.decryptFields) {
    const raw = row[spec.field as keyof typeof row];
    out[spec.field] = spec.optional
      ? await decryptFieldOptional(raw)
      : raw
      ? await decryptField(raw)
      : undefined;
  }
  return out;
}

// ============================================================================
// VERIFY — argon2 compare against a stored hash (batched)
// ============================================================================

export async function genericVerify(
  opts: GenericCrudOptions & { hashField: string },
  id: string,
  plaintext: string,
): Promise<boolean> {
  const bindings: Record<string, unknown> = {
    id: rid(id),
    __plain: plaintext,
  };
  const conds = ["id = $id"];

  const access = await buildAccessClause(opts.table, opts.tenant, "r");
  if (access.clause) {
    conds.push(access.clause);
    Object.assign(bindings, access.bindings);
  }

  // Fetch hash + compare in a single round-trip. We can't return the raw
  // hash to the client, so we compare server-side via crypto::argon2::compare.
  const query = [
    `LET $__row = (SELECT ${opts.hashField} FROM ${opts.table} ` +
    `WHERE ${conds.join(" AND ")} LIMIT 1)[0];`,
    `LET $__hash = IF $__row = NONE THEN NONE ELSE $__row.${opts.hashField} END;`,
    `RETURN IF $__hash = NONE THEN false ELSE crypto::argon2::compare($__hash, $__plain) END;`,
  ].join("\n");

  const db = await getDb();
  const result = await db.query<[boolean]>(query, bindings);
  return result[result.length - 1] === true;
}

// ============================================================================
// SHARED RECORDS
// ============================================================================

export interface SharedRecord {
  id: string;
  recordId: string;
  ownerTenantIds: string[];
  accessesTenantIds: string[];
  permissions: string[];
}

export interface ListSharedRecordsOptions {
  recordId?: string;
  tenant?: Tenant;
  limit?: number;
  cursor?: string;
}

/** List shared_record rows, optionally filtered by record and/or tenant scope. */
export async function genericListSharedRecords(
  opts: ListSharedRecordsOptions,
): Promise<PaginatedResult<SharedRecord>> {
  const conds: string[] = [];
  const bindings: Record<string, unknown> = {};

  if (opts.recordId) {
    conds.push("recordId = $recordId");
    bindings.recordId = rid(opts.recordId);
  }

  if (opts.tenant) {
    const matching = buildCallerTenantsSQL(opts.tenant, "_sr");
    Object.assign(bindings, matching.bindings);
    conds.push(
      `(ownerTenantIds ANYINSIDE ${matching.sql} OR accessesTenantIds ANYINSIDE ${matching.sql})`,
    );
  }

  const limit = Math.max(1, opts.limit ?? 50);
  bindings.__limit = limit + 1;

  if (opts.cursor) {
    conds.push("id > $__cursor");
    bindings.__cursor = rid(opts.cursor);
  }

  const where = conds.length ? ` WHERE ${conds.join(" AND ")}` : "";
  const query =
    `SELECT * FROM shared_record${where} ORDER BY id ASC LIMIT $__limit;`;

  const db = await getDb();
  const result = await db.query<[SharedRecord[]]>(query, bindings);
  const rows = result[0] ?? [];
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;

  return {
    items,
    total: items.length,
    hasMore,
    nextCursor: hasMore && items.length > 0
      ? stringifyId(items[items.length - 1].id)
      : undefined,
  };
}

/** Create a shared_record. Both tenants are resolve-or-created. */
export async function genericCreateSharedRecord(data: {
  recordId: string;
  ownerTenant: Tenant;
  accessTenant: Tenant;
  permissions: string[];
}): Promise<GenericResult<SharedRecord>> {
  const bindings: Record<string, unknown> = {
    __recordId: rid(data.recordId),
    __perms: data.permissions,
  };

  const ownerLet = buildResolveOrCreateTenantLET(data.ownerTenant, "__own");
  const accessLet = buildResolveOrCreateTenantLET(data.accessTenant, "__acc");
  Object.assign(bindings, ownerLet.bindings, accessLet.bindings);

  const query = [
    ...ownerLet.lets,
    ...accessLet.lets,
    `LET $__sr = (CREATE shared_record SET
        recordId = $__recordId,
        ownerTenantIds = [$__own],
        accessesTenantIds = [$__acc],
        permissions = $__perms)[0];`,
    `RETURN $__sr;`,
  ].join("\n");

  const db = await getDb();
  const result = await db.query<unknown[]>(query, bindings);
  const created = result[result.length - 1] as SharedRecord | undefined;
  if (!created) {
    return {
      success: false,
      errors: [{ field: "shared_record", errors: ["common.error.generic"] }],
    };
  }
  return { success: true, data: created };
}

/**
 * Delete shared_records by id. When a caller tenant is provided, only
 * shared_records the caller owns (or has 'share' access to) are actually
 * deleted — the rest are silently filtered out.
 */
export async function genericDeleteSharedRecords(
  ids: string[],
  caller?: Tenant,
): Promise<{ success: boolean; deletedCount: number }> {
  if (ids.length === 0) return { success: true, deletedCount: 0 };

  const bindings: Record<string, unknown> = {
    __ids: ids.map((i) => rid(i)),
  };

  let where = "id IN $__ids";
  if (caller) {
    const matching = buildCallerTenantsSQL(caller, "_dsr");
    Object.assign(bindings, matching.bindings);
    where += ` AND (
      ownerTenantIds ANYINSIDE ${matching.sql}
      OR (accessesTenantIds ANYINSIDE ${matching.sql} AND permissions CONTAINS "share")
    )`;
  }

  const query = `DELETE FROM shared_record WHERE ${where} RETURN BEFORE;`;
  const db = await getDb();
  const result = await db.query<[SharedRecord[]]>(query, bindings);
  return { success: true, deletedCount: (result[0] ?? []).length };
}

// ============================================================================
// addShare — grant sharing to a tenant on a record
// ----------------------------------------------------------------------------
// Authorization rules:
//   - Caller must own the record (entity.tenantIds matches caller) OR have
//     'share' permission via an existing shared_record on the record.
//   - Owners may grant any permissions. Non-owners may only grant
//     permissions they themselves hold (intersection).
//   - All of this is enforced inside the single batched query.
// ============================================================================

export async function addShare(
  opts: { table: string },
  recordId: string,
  target: Tenant,
  permissions: string[],
  caller: Tenant,
): Promise<GenericResult<SharedRecord>> {
  // Client-side sanity — filter out bogus permission tokens.
  const valid = new Set<Permission>(["r", "w", "share"]);
  const perms = permissions.filter((p): p is Permission =>
    valid.has(p as Permission)
  );
  if (perms.length === 0) {
    return {
      success: false,
      errors: [{
        field: "permissions",
        errors: ["common.error.invalidPermissions"],
      }],
    };
  }

  const bindings: Record<string, unknown> = {
    __rid: rid(recordId),
    __perms: perms,
  };

  // Resolve or create caller tenant (= owner of the new shared_record) AND
  // target tenant (= grantee).
  const callerLet = buildResolveOrCreateTenantLET(caller, "__caller");
  const targetLet = buildResolveOrCreateTenantLET(target, "__target");
  Object.assign(bindings, callerLet.bindings, targetLet.bindings);

  // For authorization we also need the caller's LOOSE matching tenant set
  // (so partial specs work for the permission check).
  const callerMatch = buildCallerTenantsSQL(caller, "_sh");
  Object.assign(bindings, callerMatch.bindings);

  const query = [
    ...callerLet.lets,
    ...targetLet.lets,

    // Is the caller a direct owner (tenantIds on the record itself)?
    `LET $__isOwner = (SELECT VALUE id FROM ${opts.table}
        WHERE id = $__rid AND tenantIds ANYINSIDE ${callerMatch.sql} LIMIT 1)[0] != NONE;`,

    // What permissions does the caller already have via shared_records?
    `LET $__callerPerms = array::distinct(array::flatten(
        SELECT VALUE permissions FROM shared_record
        WHERE recordId = $__rid
          AND accessesTenantIds ANYINSIDE ${callerMatch.sql}
     ));`,

    // Owner can share anything; others must have 'share' in their perms.
    `LET $__canShare = $__isOwner OR $__callerPerms CONTAINS "share";`,

    // Non-owners can only forward a subset of their own permissions.
    `LET $__allowedPerms = IF $__isOwner
        THEN $__perms
        ELSE array::intersect($__perms, $__callerPerms) END;`,

    `IF NOT $__canShare OR array::len($__allowedPerms) = 0 THEN
        RETURN { success: false, errors: [{ field: "permissions", errors: ["common.error.forbidden"] }] }
     END;`,

    // Create the shared_record (owner = caller tenant).
    `LET $__created = (CREATE shared_record SET
        recordId = $__rid,
        ownerTenantIds = [$__caller],
        accessesTenantIds = [$__target],
        permissions = $__allowedPerms)[0];`,

    `RETURN { success: true, data: $__created };`,
  ].join("\n");

  const db = await getDb();
  const result = await db.query<unknown[]>(query, bindings);
  return result[result.length - 1] as GenericResult<SharedRecord>;
}

// ============================================================================
// editShare — edit / remove permissions on an existing shared_record
// ----------------------------------------------------------------------------
// Authorization:
//   - The shared_record's owner can do anything, including remove anyone
//     (except the owner — owners are removed by deleting the row directly).
//   - A caller who is an accessor AND has 'share' can also edit, but the
//     resulting permission set is capped by THEIR OWN permissions.
//   - Passing `permissions: []` removes the shared_record entirely.
// ============================================================================

export async function editShare(
  sharedRecordId: string,
  updates: { permissions: string[] },
  caller: Tenant,
): Promise<GenericResult<SharedRecord | null>> {
  const valid = new Set<Permission>(["r", "w", "share"]);
  const perms = updates.permissions.filter((p): p is Permission =>
    valid.has(p as Permission)
  );

  const bindings: Record<string, unknown> = {
    __sid: rid(sharedRecordId),
    __perms: perms,
  };

  const callerMatch = buildCallerTenantsSQL(caller, "_es");
  Object.assign(bindings, callerMatch.bindings);

  const query = [
    `LET $__sr = (SELECT * FROM shared_record WHERE id = $__sid LIMIT 1)[0];`,
    `IF $__sr = NONE THEN
        RETURN { success: false, errors: [{ field: "id", errors: ["common.error.notFound"] }] }
     END;`,

    // Authorization role flags
    `LET $__isOwner = $__sr.ownerTenantIds ANYINSIDE ${callerMatch.sql};`,
    `LET $__hasShare = $__sr.accessesTenantIds ANYINSIDE ${callerMatch.sql}
                       AND $__sr.permissions CONTAINS "share";`,
    `LET $__canAct = $__isOwner OR $__hasShare;`,

    `IF NOT $__canAct THEN
        RETURN { success: false, errors: [{ field: "auth", errors: ["common.error.forbidden"] }] }
     END;`,

    // Non-owner callers get their edits capped by their own perms on the record.
    `LET $__callerPerms = IF $__isOwner THEN ["r", "w", "share"] ELSE array::distinct(array::flatten(
        SELECT VALUE permissions FROM shared_record
        WHERE recordId = $__sr.recordId
          AND accessesTenantIds ANYINSIDE ${callerMatch.sql}
     )) END;`,
    `LET $__newPerms = IF $__isOwner
        THEN $__perms
        ELSE array::intersect($__perms, $__callerPerms) END;`,

    // Empty → delete the shared_record entirely (removal).
    `IF array::len($__newPerms) = 0 THEN
        DELETE shared_record WHERE id = $__sid;
        RETURN { success: true, data: NONE };
     END;`,

    // Otherwise: update.
    `LET $__updated = (UPDATE shared_record SET permissions = $__newPerms
        WHERE id = $__sid RETURN AFTER)[0];`,
    `RETURN { success: true, data: $__updated };`,
  ].join("\n");

  const db = await getDb();
  const result = await db.query<unknown[]>(query, bindings);
  return result[result.length - 1] as GenericResult<SharedRecord | null>;
}
