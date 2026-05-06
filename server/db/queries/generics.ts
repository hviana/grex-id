import "server-only";

// ============================================================================
// generics.ts — tenant-aware, shared-record-aware generic data-access helpers
// ============================================================================
//
// ----------------------------------------------------------------------------
// CORE INVARIANTS
// ----------------------------------------------------------------------------
//
// 1. SINGLE-BATCHED-MUTATION.
//    Every exported mutation compiles into ONE multi-statement SurrealQL
//    string executed by ONE db.query(). Guards are emitted BEFORE mutations.
//    No transactions: a constraint failure mid-batch may leave earlier
//    statements applied. Schema introspection (INFO FOR TABLE) is cached
//    per process. Uniqueness is enforced by DB UNIQUE indexes.
//
// 2. TENANT AS ENTITY.
//    Tenant-scoped rows carry `tenantIds set<record<tenant>>`. A `Tenant`
//    spec is a PARTIAL selector over { id, actorId, companyId, systemId,
//    groupIds, isOwner }. `isOwner` is narrowing-only. Empty selectors fail
//    closed. Specialization order (broad→narrow): systemId → companyId →
//    groupIds → actorId.
//      · LOOSE match (default, access checks): every specified field must
//        match; unspecified fields are unconstrained on the row.
//      · EXACT match (find-or-create only): unspecified fields MUST be
//        NONE/empty on the row. Tenants are never duplicated.
//    Explicit tenant ids are resolved against `tenant` first; unknown ids
//    are never attached to records or shares.
//
// 3. ACCESS CONTROL.
//    A row is accessible iff either:
//      (a) row.tenantIds ∩ callerTenants ≠ ∅, OR
//      (b) ∃ shared_record with required permission, caller-matching
//          accessesTenantIds, owner still ⊂ row.tenantIds, and (field
//          scope empty OR ⊇ requested fields).
//    Tables without tenantIds are global (no check).
//    Modes: "any" = (a)∨(b) [default]; "tenant" = (a) only
//    [associate/disassociate, and for security tables under any mode].
//
// 4. SHARING.
//    shared_record { recordId, ownerTenantIds (size 1), accessesTenantIds,
//    permissions ⊂ {r,w,share}, fields (∅ = all fields),
//    propagationRootRecordId, propagationOwnerTenantIds,
//    propagationAccessTenantIds }.
//      · Callers only grant permissions they hold; target field scope ⊆
//        caller's field scope.
//      · Owners never silently removed.
//      · `updatedAt` is framework-managed (cache-invalidation touch); not
//        required in shared_record.fields.
//      · Initial shares (genericCreate), addShare, genericAssociate require
//        EXISTING tenant ids for targets (no implicit creation).
//      · genericCreate requires an existing caller tenant id unless
//        `allowCreateCallerTenant` is explicitly set by trusted code.
//      · Child-propagated shares keep `ownerTenantIds` = actual child
//        ownership; the root tuple lives only in propagation* keys.
//      · Direct shared_record CRUD must NEVER treat propagation* keys as
//        ownership.
//
// 5. ADMIN INVARIANT (tenant-local).
//    Admin status is per (actorId, companyId, systemId) tenant scope. A
//    tenant row counts as admin iff it references a role named "admin"
//    whose `tenantIds` CONTAINS that tenant row id. Last-admin guards use
//    this local check, never a global admin-role id.
//    Security tables {tenant, shared_record, role, permission, system,
//    company} are NEVER reachable via shared-record authority; they are
//    NOT shareable (addShare / initialShares / cascade propagation skip
//    them); their generic ops require direct tenant authority or an
//    explicitly privileged path. Guards run whenever `user`, `tenant`, or
//    `role` admin-defining fields are touched, at root or anywhere in
//    cascade, across aggregated delete sets.
//
// 6. CASCADE TREE.
//    Cascade auth is re-evaluated independently at EVERY level with the
//    same mode as the root. Additionally, each CascadeChild may declare
//    `listOptions?: GenericListOptions`. Those options:
//      · Restrict the set of descendant rows considered at that node
//        (search / dateRange / tagFilter / extraConditions).
//      · Participate in the access-field scope used to check shared-record
//        field coverage (all fields referenced by the filter block are
//        added to the per-node access fields).
//      · Apply ordering and limit to read-time hydration (planCascade).
//      · Raw `extraConditions` require `allowRawExtraConditions` on the
//        listOptions object itself (same discipline as root lists).
//
// ----------------------------------------------------------------------------
// SURREALDB 3.0 — NONE COMPARISON IN WHERE CLAUSES
// ----------------------------------------------------------------------------
//   SurrealDB 3.0 silently drops rows when a WHERE clause combines two or more
//   direct record-field comparisons to NONE with AND. Example:
//
//     -- BROKEN — returns 0 rows even when matching rows exist:
//     SELECT * FROM tenant WHERE actorId = NONE AND companyId = NONE AND systemId != NONE
//     SELECT * FROM tenant WHERE actorId IS NONE AND companyId IS NONE
//
//     -- WORKING alternatives:
//     -- (A) Boolean-negation operator (!):
//     SELECT * FROM tenant WHERE !actorId AND !companyId AND systemId != NONE
//
//     -- (B) De Morgan's law — NOT (field != NONE OR field != NONE):
//     SELECT * FROM tenant WHERE systemId != NONE AND NOT (actorId != NONE OR companyId != NONE)
//
//     -- (C) String coercion fallback (slower, use only when ! won't work):
//     SELECT * FROM tenant WHERE string::lowercase(type::string(actorId ?? 'NONE')) = 'none'
//                              AND string::lowercase(type::string(companyId ?? 'NONE')) = 'none'
//
//   A single `= NONE` comparison is fine. `!= NONE` combined with AND is fine.
//   The bug only manifests when ≥2 `field = NONE` or `field IS NONE` comparisons
//   are AND-combined in a WHERE clause against record-type table columns.
//   LET-variable comparisons (`$v = NONE AND $w = NONE`) are unaffected.
//   SET clauses (`UPDATE ... SET field = NONE`) are unaffected.
//
//   Prefer `!field` for negating NONE checks on record-type columns when the
//   field is known to be a reference (not a boolean or numeric). The `!`
//   operator is concise and avoids the bug entirely.
//
// ----------------------------------------------------------------------------
// GENERIC LIST OPTIONS — ORDER BY
// ----------------------------------------------------------------------------
//   orderBy is a comma-separated list of "<field> [ASC|DESC]" entries, e.g.
//   "createdAt ASC, name DESC". First field is the cursor field. Multi-field
//   ordering is used verbatim in the emitted ORDER BY. Cursor comparison is
//   applied on the first field with its declared direction (> for ASC,
//   < for DESC).
//
// ============================================================================
import { getDb, rid, setsToArrays } from "../connection.ts";
import { standardizeField } from "../../utils/field-standardizer.ts";
import { validateFields } from "../../utils/field-validator.ts";
import { decryptField, decryptFieldOptional } from "../../utils/crypto.ts";
import type { PaginatedResult } from "@/src/contracts/high-level/pagination";
import type { Tenant } from "@/src/contracts/tenant";
import type { SharedRecord as SharedRecordContract } from "@/src/contracts/shared-record";
import type {
  AccessMode,
  CascadeBuilder,
  CascadeChild,
  CascadeCreateChild,
  CascadeDeleteAction,
  CascadeNodeInfo,
  CascadeUpdateChild,
  CascadeUpdOpt,
  DecryptFieldSpec,
  ExpandMode,
  ExtraAccOpt,
  FieldSpec,
  GenericCrudOptions,
  GenericDeleteResult,
  GenericListOptions,
  GenericResult,
  KChild,
  Keyed,
  KNode,
  ListSharedRecordsOptions,
  Permission,
  PrivOpt,
  RawCondOpt,
  ReadPlan,
  ResolveMode,
  SelectSpec,
  TenantCreateOpt,
  ValidationError,
  WithCascade,
} from "@/src/contracts/high-level/generics";

// ============================================================================
// Types / constants
// ============================================================================

const TB = "__t_";
const MANAGED_FIELDS = new Set(["id", "tenantIds", "createdAt", "updatedAt"]);
const ADMIN_TENANT_FIELDS = new Set([
  "actorId",
  "companyId",
  "systemId",
]);
const ADMIN_ROLE_FIELDS = new Set(["name", "tenantIds"]);
const SENSITIVE_TABLES = new Set([
  "tenant",
  "shared_record",
  "role",
  "permission",
  "system",
  "company",
  "group",
]);
const VALID_PERMS: ReadonlySet<Permission> = new Set(["r", "w", "share"]);

type ParsedOrder = { field: string; direction: "ASC" | "DESC" };
/** Anything that looks like a list-filter options bag. */
type ListOptsLike =
  & GenericListOptions
  & Partial<RawCondOpt>
  & Partial<ExtraAccOpt>;

// ============================================================================
// Schema cache
// ============================================================================

/** table → field → type string (e.g. "set<record<role>>", "string", "option<int>"). */
const fieldCache = new Map<string, Map<string, string>>();

/** Extract the bare type specifier from a DEFINE FIELD statement returned by
 *  INFO FOR TABLE. Example input:
 *    "DEFINE FIELD roleIds ON resource_limit TYPE none | set<record<role>> PERMISSIONS FULL"
 *  →  "none | set<record<role>>" */
function parseTypeFromDefine(def: string): string {
  const m = def.match(
    /\bTYPE\s+(.+?)(?:\s+(?:PERMISSIONS|DEFAULT|READONLY|COMMENT|VALUE|ASSERT)\b|\s*$)/,
  );
  return m?.[1]?.trim() ?? def;
}

async function getFieldTypes(table: string): Promise<Map<string, string>> {
  if (!fieldCache.has(table)) {
    const db = await getDb();
    const res = await db.query<[{ fields?: Record<string, unknown> }]>(
      `INFO FOR TABLE ${table};`,
    );
    const raw = res[0];
    const info = Array.isArray(raw) ? raw[0] : raw;
    const types = new Map<string, string>();
    if (info?.fields) {
      for (const [name, type] of Object.entries(info.fields)) {
        types.set(name, parseTypeFromDefine(String(type)));
      }
    }
    fieldCache.set(table, types);
  }
  return fieldCache.get(table)!;
}

async function tableHasField(table: string, field: string): Promise<boolean> {
  const types = await getFieldTypes(table);
  return types.has(field);
}

/** Build a SurrealDB set literal from an array of record-ID strings
 *  (or StringRecordId objects). Produces: {type::record("tb","id"),} */
function buildSetLiteral(ids: unknown[]): string {
  const parts = ids.map((id) => {
    const [tb, k] = String(id).split(":");
    return `type::record("${tb}", "${k}")`;
  });
  return `{${parts.join(", ")},}`;
}

// ============================================================================
// Utilities
// ============================================================================

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

function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>(
    (
      a,
      k,
    ) => (a && typeof a === "object"
      ? (a as Record<string, unknown>)[k]
      : undefined),
    obj,
  );
}

function safeBindingName(prefix: string, field: string, i: number): string {
  return `${prefix || "__set"}_${i}_${field.replace(/[^A-Za-z0-9_]/g, "_")}`;
}

function isGenericFailure(
  v: unknown,
): v is { success: false; errors?: ValidationError[]; errorKey?: string } {
  return !!v && typeof v === "object" && !Array.isArray(v) &&
    (v as { success?: unknown }).success === false;
}

function findEarlyError<T extends { errorKey?: string }>(
  result: unknown[],
): T | undefined {
  return result.find((e): e is T =>
    !!e && typeof e === "object" && !Array.isArray(e) && "errorKey" in e
  );
}

function valueContainsId(v: unknown, id: unknown): boolean {
  if (v == null || id == null) return false;
  const t = stringifyId(id);
  if (Array.isArray(v) || v instanceof Set) {
    return [...(v as Iterable<unknown>)].some((e) => stringifyId(e) === t);
  }
  return stringifyId(v) === t;
}

function valErr(field: string, error: string): ValidationError[] {
  return [{ field, errors: [error] }];
}
function failV(field: string, error: string) {
  return { success: false as const, errors: valErr(field, error) };
}

function getListOptions(
  c: CascadeChild | undefined,
): ListOptsLike | undefined {
  return (c as { listOptions?: ListOptsLike } | undefined)?.listOptions;
}

// ============================================================================
// Safety assertions
// ============================================================================

function isSafeIdent(v: string | undefined): v is string {
  return !!v && /^[A-Za-z_][A-Za-z0-9_]*$/.test(v);
}
function isSafeFieldPath(v: string | undefined): v is string {
  return !!v && /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(v);
}

function assertSafe(
  kind: "ident" | "field",
  v: string | undefined,
  label: string,
): asserts v is string {
  const ok = kind === "ident" ? isSafeIdent(v) : isSafeFieldPath(v);
  if (!ok) {
    throw new Error(
      `common.error.unsafe${
        kind === "ident" ? "Identifier" : "Field"
      }:${label}`,
    );
  }
}

function assertSafeFieldPaths(vs: (string | undefined)[], label: string): void {
  for (const v of vs) assertSafe("field", v, label);
}

function assertSafeSelect(s: SelectSpec, label: string): void {
  const raw = normalizeSelect(s);
  if (raw === "*") return;
  if (!parseSelectFields(s)) {
    throw new Error(`common.error.unsafeSelect:${label}`);
  }
}

// ----------------------------------------------------------------------------
// ORDER BY parsing — single source of truth
// ----------------------------------------------------------------------------

function parseOrderBy(
  orderBy: string | undefined,
  fallback: string,
): ParsedOrder[] {
  const raw = (orderBy ?? fallback).trim();
  if (!raw) throw new Error("common.error.unsafeOrderBy:empty");
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) throw new Error("common.error.unsafeOrderBy:empty");
  return parts.map((p) => {
    const m = p.match(
      /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)(?:\s+(ASC|DESC))?$/i,
    );
    if (!m) throw new Error(`common.error.unsafeOrderBy:${p}`);
    return {
      field: m[1],
      direction: (m[2]?.toUpperCase() as "ASC" | "DESC") ?? "ASC",
    };
  });
}

function orderBySQL(parsed: ParsedOrder[]): string {
  return parsed.map((p) => `${p.field} ${p.direction}`).join(", ");
}
function orderByFields(parsed: ParsedOrder[]): string[] {
  return parsed.map((p) => p.field);
}

function assertSafeOrderBy(v: string | undefined, label: string): void {
  if (v === undefined) return;
  try {
    parseOrderBy(v, "id");
  } catch {
    throw new Error(`common.error.unsafeOrderBy:${label}`);
  }
}

/** Shape-safety for any listOptions-like object (root or cascade). */
function assertSafeListOptions(lo: ListOptsLike, label: string): void {
  if (lo.searchFields) {
    assertSafeFieldPaths(lo.searchFields, `${label}.searchFields`);
  }
  if (lo.dateRangeField) {
    assertSafe("field", lo.dateRangeField, `${label}.dateRangeField`);
  }
  if (lo.tagFilter?.tagsColumn) {
    assertSafe(
      "field",
      lo.tagFilter.tagsColumn,
      `${label}.tagFilter.tagsColumn`,
    );
  }
  if (lo.extraAccessFields) {
    assertSafeFieldPaths(lo.extraAccessFields, `${label}.extraAccessFields`);
  }
  if (lo.extraConditions?.length && !lo.allowRawExtraConditions) {
    throw new Error(
      `common.error.rawExtraConditionsRequireExplicitOptIn:${label}`,
    );
  }
  assertSafeOrderBy(lo.orderBy, `${label}.orderBy`);
}

function assertSafeCascade(
  cs: CascadeChild[] | undefined,
  label: string,
): void {
  if (!cs?.length) return;
  for (const c of cs) {
    assertSafe("ident", c.table, `table:${c.table}`);
    if (!c.sourceField && !c.parentField) {
      throw new Error(
        `common.error.cascadeRequiresExplicitLink:${label}.${c.table}`,
      );
    }
    if (c.sourceField && c.parentField) {
      throw new Error(
        `common.error.cascadeLinkMustBeUnambiguous:${label}.${c.table}`,
      );
    }
    const k = cascadeKey(c as KChild);
    if (k) assertSafe("ident", k, `${label}.${c.table}.key`);
    if (c.sourceField) {
      assertSafe("field", c.sourceField, `${label}.sourceField`);
    }
    if (c.parentField) {
      assertSafe("field", c.parentField, `${label}.parentField`);
    }
    const ext = c as KChild;
    if (ext.select !== undefined) {
      assertSafeSelect(ext.select, `${label}.${c.table}.select`);
    }
    if (ext.accessFields) {
      assertSafeFieldPaths(
        ext.accessFields,
        `${label}.${c.table}.accessFields`,
      );
    }
    if (ext.countAccessFields) {
      assertSafeFieldPaths(
        ext.countAccessFields,
        `${label}.${c.table}.countAccessFields`,
      );
    }
    const lo = getListOptions(c);
    if (lo) assertSafeListOptions(lo, `${label}.${c.table}.listOptions`);
    assertSafeCascade(c.children, `${label}.${c.table}.children`);
  }
}

function assertSafeDeleteCascade(
  cs: CascadeChild[] | undefined,
  label: string,
): void {
  if (!cs?.length) return;
  for (const c of cs) {
    const a = (c as KChild).onDelete;
    if (a !== "delete" && a !== "detach" && a !== "restrict") {
      throw new Error(
        `common.error.cascadeDeleteActionRequired:${label}.${c.table}`,
      );
    }
    assertSafeDeleteCascade(c.children, `${label}.${c.table}.children`);
  }
}

function getDeleteAction(n: CascadeNodeInfo): CascadeDeleteAction {
  const a = (n as KNode).onDelete;
  if (a !== "delete" && a !== "detach" && a !== "restrict") {
    throw new Error(`common.error.cascadeDeleteActionRequired:${n.table}`);
  }
  return a;
}

function assertSafeCrud(
  opts: GenericCrudOptions & { select?: SelectSpec },
  label: string,
): void {
  assertSafe("ident", opts.table, `table:${opts.table}`);
  assertSafeCascade(opts.cascade, `${label}.cascade`);
  if (opts.select !== undefined) {
    assertSafeSelect(opts.select, `${label}.select`);
  }
}

function assertSafeListish(
  opts: ListOptsLike,
  label: string,
  withCursor: boolean,
): void {
  assertSafe("ident", opts.table, `table:${opts.table}`);
  assertSafeCascade(opts.cascade, `${label}.cascade`);
  assertSafeListOptions(opts, label);
  if (!withCursor) return;
  // Cursor pagination needs at least one orderBy field (first = cursor field).
  const parsed = parseOrderBy(opts.orderBy, "id");
  if (parsed[0].field.includes(".")) {
    throw new Error(
      `common.error.cursorFieldMustBeTopLevel:${parsed[0].field}`,
    );
  }
}

// ============================================================================
// Privilege gates
// ============================================================================

function isSensitive(t: string): boolean {
  return SENSITIVE_TABLES.has(t);
}

async function getTableError(
  table: string,
  mode: "read" | "mutation",
  opts?: PrivOpt,
): Promise<string | null> {
  if (!isSensitive(table)) return null;
  if (await tableHasField(table, "tenantIds")) return null;
  const optIn = mode === "read"
    ? opts?.allowSensitiveGlobalRead
    : opts?.allowSensitiveGlobalMutation;
  if (optIn) return null;
  return mode === "read"
    ? "common.error.privilegedTableReadRequiresExplicitOptIn"
    : "common.error.privilegedTableRequiresExplicitOptIn";
}

async function getCascadeTableError(
  cs: CascadeChild[] | undefined,
  mode: "read" | "mutation",
  opts?: PrivOpt,
): Promise<string | null> {
  if (!cs?.length) return null;
  for (const c of cs) {
    const e = await getTableError(c.table, mode, opts);
    if (e) return `${c.table}:${e}`;
    const n = await getCascadeTableError(c.children, mode, opts);
    if (n) return n;
  }
  return null;
}

// ============================================================================
// Cascade node helpers
// ============================================================================

function cascadeKey(
  n: { key?: string; cascadeKey?: string } | undefined,
): string | undefined {
  return n?.key ?? n?.cascadeKey;
}
function cascadeLabel(
  n: { table: string; key?: string; cascadeKey?: string },
): string {
  return cascadeKey(n) ?? n.table;
}

function findCascadeMatch<
  T extends { table: string; key?: string; cascadeKey?: string },
>(
  entry: T,
  siblings: CascadeChild[],
  used: Set<number>,
): { spec?: CascadeChild; index?: number; error?: string } {
  const ek = cascadeKey(entry);
  if (ek) {
    const i = siblings.findIndex((c, idx) =>
      !used.has(idx) && cascadeKey(c as KChild) === ek
    );
    return i >= 0
      ? { spec: siblings[i], index: i }
      : { error: "common.error.cascadeNodeUnknown" };
  }
  const matches = siblings.map((c, i) => ({ c, i })).filter(({ c, i }) =>
    !used.has(i) && !cascadeKey(c as KChild) && c.table === entry.table
  );
  if (matches.length > 1) {
    return { error: "common.error.cascadePayloadKeyRequired" };
  }
  return matches.length === 1
    ? { spec: matches[0].c, index: matches[0].i }
    : { error: "common.error.cascadeTableUnknown" };
}

// ============================================================================
// Tenant selector + resolver
// ============================================================================

function hasTenantSelector(t: Tenant | undefined): t is Tenant {
  return !!t &&
    (!!t.id || !!t.actorId || !!t.companyId || !!t.systemId ||
      !!t.groupIds?.length);
}

function tenantSelectorErr(field = "tenant"): ValidationError[] {
  return valErr(field, "common.error.tenantSelectorRequired");
}

function tenantResolvedGuard(v: string, field: string): string {
  return `IF $${v} = NONE THEN
      RETURN { success: false, errors: [{ field: "${field}", errors: ["common.error.tenantNotFound"] }] };
   END;`;
}

function touchesAdminTenantFields(f: string[]): boolean {
  return f.some((x) => ADMIN_TENANT_FIELDS.has(x.split(".")[0]));
}
function touchesAdminRoleFields(f: string[]): boolean {
  return f.some((x) => ADMIN_ROLE_FIELDS.has(x.split(".")[0]));
}

function buildCallerTenantsSQL(
  t: Tenant | undefined,
  suffix = "",
): { sql: string; bindings: Record<string, unknown> } {
  if (!hasTenantSelector(t)) return { sql: "{,}", bindings: {} };
  const b = (n: string) => `${TB}${n}${suffix}`;
  const bindings: Record<string, unknown> = {};
  const orClauses: string[] = [];

  // Clause 1: direct id match (JWT-guaranteed — works for users and API tokens)
  if (t.id) {
    orClauses.push(`id = $${b("id")}`);
    bindings[b("id")] = rid(t.id);
  }

  // Clause 2: actor-scoped match (same actor in same company+system)
  const actorConds: string[] = [];
  if (t.actorId) {
    actorConds.push(`actorId = $${b("aId")}`);
    bindings[b("aId")] = rid(t.actorId);
  }
  if (t.companyId) {
    actorConds.push(`companyId = $${b("cId")}`);
    bindings[b("cId")] = rid(t.companyId);
  }
  if (t.systemId) {
    actorConds.push(`systemId = $${b("sId")}`);
    bindings[b("sId")] = rid(t.systemId);
  }
  if (actorConds.length) {
    orClauses.push(`(${actorConds.join(" AND ")})`);
  }

  // Clause 3: group / owner filters
  if (t.groupIds?.length) {
    orClauses.push(`groupIds CONTAINSALL $${b("gIds")}`);
    bindings[b("gIds")] = t.groupIds.map((g) => rid(g));
  }
  if (t.isOwner !== undefined) {
    orClauses.push(`isOwner = $${b("own")}`);
    bindings[b("own")] = t.isOwner;
  }

  const where = orClauses.length ? ` WHERE ${orClauses.join(" OR ")}` : "";
  return {
    sql: `<set>(SELECT VALUE id FROM tenant${where})`,
    bindings,
  };
}

function resolveTenantLET(
  t: Tenant,
  varName: string,
  mode: ResolveMode,
): { lets: string[]; bindings: Record<string, unknown> } {
  if (!hasTenantSelector(t)) {
    throw new Error("common.error.tenantSelectorRequired");
  }
  if (mode === "existing" && !t.id) {
    throw new Error("common.error.existingTenantIdRequired");
  }

  const b: Record<string, unknown> = {};
  const bName = (k: string) => `${varName}_${k}`;

  if (t.id) {
    b[bName("idBind")] = rid(t.id);
    const conds = [`id = $${bName("idBind")}`];
    if (t.actorId) {
      b[bName("aId")] = rid(t.actorId);
      conds.push(`actorId = $${bName("aId")}`);
    }
    if (t.companyId) {
      b[bName("cId")] = rid(t.companyId);
      conds.push(`companyId = $${bName("cId")}`);
    }
    if (t.systemId) {
      b[bName("sId")] = rid(t.systemId);
      conds.push(`systemId = $${bName("sId")}`);
    }
    if (t.groupIds?.length) {
      b[bName("gIds")] = t.groupIds.map((g) => rid(g));
      conds.push(
        `array::len(groupIds) = array::len($${
          bName("gIds")
        }) AND groupIds CONTAINSALL $${bName("gIds")}`,
      );
    }
    if (t.isOwner !== undefined) {
      b[bName("own")] = t.isOwner;
      conds.push(`isOwner = $${bName("own")}`);
    }
    return {
      lets: [
        `LET $${varName} = (SELECT VALUE id FROM tenant WHERE ${
          conds.join(" AND ")
        } LIMIT 1)[0];`,
        `LET $${varName}_created = false;`,
      ],
      bindings: b,
    };
  }

  // SurrealDB 3.0: two or more direct = NONE comparisons with AND silently
  // drop rows. Use boolean negation (!field) for NONE checks instead.
  const aE = t.actorId ? `$${bName("aId")}` : null;
  const aF = t.actorId ? `actorId = ${aE}` : "!actorId";
  const cE = t.companyId ? `$${bName("cId")}` : null;
  const cF = t.companyId ? `companyId = ${cE}` : "!companyId";
  const sE = t.systemId ? `$${bName("sId")}` : null;
  const sF = t.systemId ? `systemId = ${sE}` : "!systemId";
  if (t.actorId) b[bName("aId")] = rid(t.actorId);
  if (t.companyId) b[bName("cId")] = rid(t.companyId);
  if (t.systemId) b[bName("sId")] = rid(t.systemId);

  const gArr = (t.groupIds ?? []).map((g) => rid(g));
  b[bName("gIds")] = gArr;
  // Empty groupIds → NONE in the SQL, not an empty array which would fail
  // SurrealDB coercion for set<record<group>>.
  const gBind = gArr.length > 0 ? `$${bName("gIds")}` : "NONE";
  const gLen = gArr.length > 0 ? `array::len($${bName("gIds")})` : "0";
  const gContains = gArr.length > 0
    ? `groupIds CONTAINSALL $${bName("gIds")}`
    : "true";
  b[bName("own")] = t.isOwner ?? false;

  const find = `(SELECT VALUE id FROM tenant
      WHERE ${aF} AND ${cF} AND ${sF}
        AND array::len(IF groupIds = NONE THEN [] ELSE groupIds END) = ${gLen}
        AND ${gContains}
        AND isOwner = $${bName("own")} LIMIT 1)[0]`;
  const create = `(CREATE tenant SET
      actorId = ${aE ?? "NONE"}, companyId = ${cE ?? "NONE"}, systemId = ${
    sE ?? "NONE"
  },
      groupIds = ${gBind}, isOwner = $${bName("own")})[0].id`;

  return {
    lets: [
      `LET $${varName}_found = ${find};`,
      `LET $${varName}_created = $${varName}_found = NONE;`,
      `LET $${varName} = IF $${varName}_found != NONE THEN $${varName}_found ELSE ${create} END;`,
    ],
    bindings: b,
  };
}

// ============================================================================
// Access clause
// ============================================================================

async function buildAccessClause(
  table: string,
  tenant: Tenant | undefined,
  permission: Permission,
  suffix = "",
  fields?: string[],
  mode: AccessMode = "any",
): Promise<{ clause: string; bindings: Record<string, unknown> }> {
  if (!(await tableHasField(table, "tenantIds"))) {
    return { clause: "", bindings: {} };
  }
  if (!hasTenantSelector(tenant)) return { clause: "false", bindings: {} };

  const match = buildCallerTenantsSQL(tenant, suffix);
  const bindings: Record<string, unknown> = { ...match.bindings };

  if (mode === "tenant" || isSensitive(table)) {
    return { clause: `tenantIds CONTAINSANY ${match.sql}`, bindings };
  }

  const pk = `${TB}perm${suffix}`;
  const fCond = fields?.length
    ? ` AND (set::len(fields) = 0 OR fields CONTAINSALL $${TB}rf${suffix})`
    : "";
  const clause = `(
    tenantIds CONTAINSANY ${match.sql}
    OR id IN (
      SELECT VALUE recordId FROM shared_record
      WHERE permissions CONTAINS $${pk}
        AND ownerTenantIds CONTAINSANY (recordId.tenantIds ?? [])
        AND accessesTenantIds CONTAINSANY ${match.sql}${fCond}
    )
  )`;
  bindings[pk] = permission;
  if (fields?.length) bindings[`${TB}rf${suffix}`] = fields;
  return { clause, bindings };
}

async function buildIdAccessWhere(
  table: string,
  idBind: string,
  tenant: Tenant | undefined,
  perm: Permission,
  suffix = "",
  mode: AccessMode = "any",
  fields?: string[],
  skipAccess = false,
): Promise<{ where: string[]; bindings: Record<string, unknown> }> {
  const where = [`id = $${idBind}`];
  const bindings: Record<string, unknown> = {};
  if (skipAccess) return { where, bindings };
  const a = await buildAccessClause(
    table,
    tenant,
    perm,
    suffix,
    fields?.length ? fields : undefined,
    mode,
  );
  if (a.clause) {
    where.push(a.clause);
    Object.assign(bindings, a.bindings);
  }
  return { where, bindings };
}

// ============================================================================
// Filter block — unified for root list / count AND cascade child listOptions
// ============================================================================

/**
 * Emit filter conditions/bindings from any listOptions-shaped object AND
 * report which fields it touches (for access-scope merging). Does NOT emit
 * the access clause — callers combine with buildAccessClause.
 *
 * Raw `extraConditions` require `allowRawExtraConditions` on `lo` itself,
 * so discipline is uniform at root and in cascade nodes.
 */
async function buildFilterBlock(
  lo: ListOptsLike | undefined,
  suffix: string,
  label: string,
): Promise<{
  conds: string[];
  bindings: Record<string, unknown>;
  fields: string[];
}> {
  const conds: string[] = [];
  const bindings: Record<string, unknown> = {};
  const fields: string[] = [];
  if (!lo) return { conds, bindings, fields };

  if (lo.extraConditions?.length && !lo.allowRawExtraConditions) {
    throw new Error(
      `common.error.rawExtraConditionsRequireExplicitOptIn:${label}`,
    );
  }
  const b = (k: string) => `${TB}fb${suffix}_${k}`;

  if (lo.search && lo.searchFields?.length) {
    assertSafeFieldPaths(lo.searchFields, `${label}.searchFields`);
    const sk = b("s");
    conds.push(
      `(${lo.searchFields.map((f) => `${f} @@ $${sk}`).join(" OR ")})`,
    );
    bindings[sk] = lo.search;
    fields.push(...lo.searchFields);
  }
  if (lo.dateRange && lo.dateRangeField) {
    assertSafe("field", lo.dateRangeField, `${label}.dateRangeField`);
    if (lo.dateRange.start) {
      const k = b("drs");
      conds.push(`${lo.dateRangeField} >= $${k}`);
      bindings[k] = lo.dateRange.start;
    }
    if (lo.dateRange.end) {
      const k = b("dre");
      conds.push(`${lo.dateRangeField} <= $${k}`);
      bindings[k] = lo.dateRange.end;
    }
    fields.push(lo.dateRangeField);
  }
  if (lo.tagFilter?.tagNames.length) {
    const col = lo.tagFilter.tagsColumn ?? "tagIds";
    assertSafe("field", col, `${label}.tagFilter.tagsColumn`);
    lo.tagFilter.tagNames.forEach((name, i) => {
      const k = b(`tag_${i}`);
      conds.push(
        `${col} CONTAINS (SELECT VALUE id FROM tag WHERE name = $${k} LIMIT 1)`,
      );
      bindings[k] = name;
    });
    fields.push(col);
  }
  if (lo.extraConditions?.length) {
    if (!lo.extraAccessFields?.length) {
      throw new Error(
        `common.error.extraConditionsRequireAccessFields:${label}`,
      );
    }
    assertSafeFieldPaths(lo.extraAccessFields, `${label}.extraAccessFields`);
    conds.push(...lo.extraConditions);
    Object.assign(bindings, lo.extraBindings ?? {});
    fields.push(...lo.extraAccessFields);
  }

  return { conds, bindings, fields: uniqueFields(fields) };
}

/** Static report of fields a listOptions filter-block references. */
function listOptionsFields(lo: ListOptsLike | undefined): string[] {
  if (!lo) return [];
  const f: string[] = [];
  if (lo.search && lo.searchFields?.length) f.push(...lo.searchFields);
  if (lo.dateRange && lo.dateRangeField) f.push(lo.dateRangeField);
  if (lo.tagFilter?.tagNames.length) {
    f.push(lo.tagFilter.tagsColumn ?? "tagIds");
  }
  if (lo.extraConditions?.length && lo.extraAccessFields) {
    f.push(...lo.extraAccessFields);
  }
  if (lo.orderBy) {
    try {
      f.push(...orderByFields(parseOrderBy(lo.orderBy, "id")));
    } catch { /* surfaced elsewhere */ }
  }
  return uniqueFields(f);
}

// ============================================================================
// Read select helpers
// ============================================================================

function normalizeSelect(s: SelectSpec): string {
  if (Array.isArray(s)) return s.join(", ");
  return s?.trim() || "*";
}
function parseSelectFields(s: SelectSpec): string[] | undefined {
  const raw = normalizeSelect(s);
  if (raw === "*") return undefined;
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return undefined;
  return parts.every(isSafeFieldPath) ? parts : undefined;
}
function uniqueFields(fs: (string | undefined)[]): string[] {
  return [...new Set(fs.filter(isSafeFieldPath))];
}

async function buildListAccessFields(
  opts: ListOptsLike,
  selected: string[] | undefined,
  withOrder: boolean,
): Promise<string[] | undefined> {
  if (!(await tableHasField(opts.table, "tenantIds")) || !opts.tenant) {
    return selected;
  }
  const f: string[] = [...(selected ?? [])];
  f.push(...listOptionsFields(opts));
  if (withOrder) {
    const parsed = parseOrderBy(opts.orderBy, "id");
    f.push(...orderByFields(parsed));
  }
  const bad = f.find((x) => !isSafeFieldPath(x));
  if (bad) throw new Error(`common.error.sharedReadRequiresSimpleField:${bad}`);
  return uniqueFields(f);
}

async function buildReadAccess(
  table: string,
  tenant: Tenant | undefined,
  suffix: string,
  select: SelectSpec,
  extraFields?: string[],
  skipAccess = false,
): Promise<
  {
    clause: string;
    bindings: Record<string, unknown>;
    selectSql: string;
    readFields?: string[];
    accessFields?: string[];
  }
> {
  const selectSql = normalizeSelect(select);
  const readFields = parseSelectFields(select);
  const hasT = await tableHasField(table, "tenantIds");
  if (tenant && hasT && !readFields?.length) {
    throw new Error(`common.error.sharedReadRequiresConcreteSelect:${table}`);
  }
  const accessFields = uniqueFields([
    ...(readFields ?? []),
    ...(extraFields ?? []),
  ]).filter((f) => f !== "id");
  const a = skipAccess ? { clause: "", bindings: {} } : await buildAccessClause(
    table,
    tenant,
    "r",
    suffix,
    accessFields.length ? accessFields : undefined,
    "any",
  );
  return { ...a, selectSql, readFields, accessFields };
}

// ============================================================================
// Validation & SET clauses
// ============================================================================

async function standardizeAndValidate(
  specs: FieldSpec[],
  data: Record<string, unknown>,
  partial: boolean,
): Promise<
  { ok: true; data: Record<string, unknown> } | {
    ok: false;
    errors: ValidationError[];
  }
> {
  const processed: Record<string, unknown> = { ...data };
  if (!specs.length) {
    return {
      ok: false,
      errors: valErr("fields", "common.error.fieldsRequired"),
    };
  }
  const declared = new Set(specs.map((s) => s.field));

  for (const k of Object.keys(processed)) {
    if (!isSafeFieldPath(k)) {
      return { ok: false, errors: valErr(k, "common.error.unsafeField") };
    }
    if (MANAGED_FIELDS.has(k)) {
      return { ok: false, errors: valErr(k, "common.error.managedField") };
    }
    if (!declared.has(k)) {
      return { ok: false, errors: valErr(k, "common.error.unknownField") };
    }
  }

  const valInput: { field: string; value: unknown }[] = [];
  for (const s of specs) {
    if (partial && !(s.field in processed)) continue;
    const raw = processed[s.field];
    if (typeof raw === "string") {
      processed[s.field] = await standardizeField(
        s.field,
        raw,
        s.entity,
        s.encryption,
      );
    }
    valInput.push({ field: s.field, value: processed[s.field] });
  }
  if (!valInput.length) return { ok: true, data: processed };

  const errs = await validateFields(valInput);
  if (Object.keys(errs).length) {
    return {
      ok: false,
      errors: Object.entries(errs).map(([field, e]) => ({ field, errors: e })),
    };
  }
  return { ok: true, data: processed };
}

async function buildSetClauses(
  table: string,
  data: Record<string, unknown>,
  bindings: Record<string, unknown>,
  opts: { isCreate: boolean; bindingPrefix?: string },
): Promise<string[]> {
  const cs: string[] = [];
  if (opts.isCreate && (await tableHasField(table, "createdAt"))) {
    cs.push("createdAt = time::now()");
  }
  if (await tableHasField(table, "updatedAt")) {
    cs.push("updatedAt = time::now()");
  }
  const fieldTypes = await getFieldTypes(table);
  const prefix = opts.bindingPrefix ?? "";
  let i = 0;
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    assertSafe("field", k, `set.${table}.${k}`);
    if (Array.isArray(v)) {
      const ft = fieldTypes.get(k) ?? "";
      if (/set<record</.test(ft)) {
        cs.push(`${k} = ${v.length > 0 ? buildSetLiteral(v) : "<set>[]"}`);
        continue;
      }
      if (v.length === 0) {
        cs.push(`${k} = <set>[]`);
        continue;
      }
    }
    const b = safeBindingName(prefix, k, i++);
    bindings[b] = v;
    cs.push(`${k} = $${b}`);
  }
  return cs;
}

function explicitFields(data: Record<string, unknown>): string[] {
  return Object.keys(data).filter((f) => data[f] !== undefined);
}

// ============================================================================
// Cascade ids collector / expansion / coverage
// ============================================================================

async function collectCascadeIds(
  cascade: CascadeChild[],
  rootTable: string,
  rootIdsVar: string,
  caller: Tenant | undefined,
  permission: Permission,
  suffix: string,
  mode: ExpandMode = "any",
  fieldsByTable?: Map<string, string[]>,
): Promise<
  {
    lets: string[];
    bindings: Record<string, unknown>;
    nodes: CascadeNodeInfo[];
  }
> {
  const lets: string[] = [];
  const bindings: Record<string, unknown> = {};
  const nodes: CascadeNodeInfo[] = [];
  let counter = 0;

  const walk = async (
    children: CascadeChild[],
    parentTable: string,
    parentIdsVar: string,
  ) => {
    for (const child of children) {
      const src = child.sourceField, pf = child.parentField;
      if (!src && !pf) continue;
      const slot = counter++;
      const idsVar = `__cc_${suffix}_${slot}`;
      const slotKey = `${suffix}_${slot}`;

      // Cascade-child listOptions filter (also contributes fields to scope).
      const lo = getListOptions(child);
      const filter = await buildFilterBlock(
        lo,
        slotKey,
        `cascade.${child.table}.listOptions`,
      );
      Object.assign(bindings, filter.bindings);

      // Effective access fields = preset ∪ filter-touched.
      const preset = fieldsByTable?.get(slotKey) ??
        fieldsByTable?.get(child.table);
      const effFields = (preset?.length || filter.fields.length)
        ? uniqueFields([...(preset ?? []), ...filter.fields]).filter(
          (f) => f !== "id",
        )
        : undefined;

      const access = mode === "raw"
        ? { clause: "", bindings: {} as Record<string, unknown> }
        : await buildAccessClause(
          child.table,
          caller,
          permission,
          `_cc_${suffix}_${slot}`,
          effFields?.length ? effFields : undefined,
          mode,
        );
      Object.assign(bindings, access.bindings);

      const extras = [
        ...(access.clause ? [access.clause] : []),
        ...filter.conds,
      ];
      const extra = extras.length ? ` AND ${extras.join(" AND ")}` : "";

      let sel: string;
      if (src) {
        const srcIds = child.isArray
          ? `array::flatten((SELECT VALUE ${src} FROM ${parentTable} WHERE id IN $${parentIdsVar}))`
          : `(SELECT VALUE ${src} FROM ${parentTable} WHERE id IN $${parentIdsVar})`;
        sel =
          `SELECT VALUE id FROM ${child.table} WHERE id IN ${srcIds}${extra}`;
      } else {
        const op = child.isArray ? "CONTAINSANY" : "IN";
        sel =
          `SELECT VALUE id FROM ${child.table} WHERE ${pf} ${op} $${parentIdsVar}${extra}`;
      }

      lets.push(`LET $${idsVar} = array::distinct((${sel}));`);
      nodes.push(
        {
          table: child.table,
          idsVar,
          parentTable,
          parentIdsVar,
          sourceField: src,
          parentField: pf,
          isArray: child.isArray ?? false,
          onDelete: (child as KChild).onDelete,
        } as CascadeNodeInfo & KNode,
      );

      if (child.children?.length) {
        await walk(child.children, child.table, idsVar);
      }
    }
  };

  await walk(cascade, rootTable, rootIdsVar);
  return { lets, bindings, nodes };
}

function unionCascadeIdsSQL(
  rootIdsVar: string,
  nodes: CascadeNodeInfo[],
): string {
  if (!nodes.length) return `$${rootIdsVar}`;
  return `array::union($${rootIdsVar}, ${
    nodes.map((n) => `$${n.idsVar}`).join(", ")
  })`;
}

async function expandCascade(
  rootTable: string,
  rootIdExpr: string,
  cascade: CascadeChild[] | undefined,
  caller: Tenant | undefined,
  permission: Permission,
  suffix: string,
  mode: ExpandMode = "any",
  fieldsByTable?: Map<string, string[]>,
): Promise<
  {
    lets: string[];
    bindings: Record<string, unknown>;
    rootIdsVar: string;
    nodes: CascadeNodeInfo[];
    unionExpr: string;
  }
> {
  const rootIdsVar = `__ce_${suffix}_root`;
  const lets: string[] = [`LET $${rootIdsVar} = [${rootIdExpr}];`];
  const bindings: Record<string, unknown> = {};
  let nodes: CascadeNodeInfo[] = [];
  if (cascade?.length) {
    const col = await collectCascadeIds(
      cascade,
      rootTable,
      rootIdsVar,
      caller,
      permission,
      `ce_${suffix}`,
      mode,
      fieldsByTable,
    );
    lets.push(...col.lets);
    Object.assign(bindings, col.bindings);
    nodes = col.nodes;
  }
  return {
    lets,
    bindings,
    rootIdsVar,
    nodes,
    unionExpr: unionCascadeIdsSQL(rootIdsVar, nodes),
  };
}
function buildFullRecordCascadeAccessFields(
  cascade: CascadeChild[] | undefined,
): Map<string, string[]> | undefined {
  if (!cascade?.length) return undefined;

  const out = new Map<string, string[]>();

  const walk = (children: CascadeChild[]) => {
    for (const child of children) {
      out.set(child.table, []);
      if (child.children?.length) walk(child.children);
    }
  };

  walk(cascade);
  return out;
}
function buildCoverageGuard(
  raw: CascadeNodeInfo[],
  auth: CascadeNodeInfo[],
  errorKey = "common.error.cascadeUnauthorized",
  shouldGuard: (
    r: CascadeNodeInfo,
    a: CascadeNodeInfo | undefined,
    i: number,
  ) => boolean = () => true,
): string[] {
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (!shouldGuard(raw[i], auth[i], i)) continue;
    const authExpr = auth[i] ? `$${auth[i].idsVar}` : "[]";
    out.push(
      `IF array::len(array::difference($${raw[i].idsVar}, ${authExpr})) > 0 THEN
         RETURN { success: false, errorKey: "${errorKey}", errors: [{ field: "cascade", errors: ["${errorKey}"] }] };
       END;`,
    );
  }
  return out;
}

async function filterNodes(
  nodes: CascadeNodeInfo[],
  mode: "tenantScoped" | "shareable",
): Promise<CascadeNodeInfo[]> {
  const out: CascadeNodeInfo[] = [];
  for (const n of nodes) {
    if (mode === "shareable" && isSensitive(n.table)) continue;
    if (await tableHasField(n.table, "tenantIds")) out.push(n);
  }
  return out;
}

async function nodeIndexSet(
  nodes: CascadeNodeInfo[],
  predicate: (n: CascadeNodeInfo) => Promise<boolean> | boolean,
): Promise<Set<number>> {
  const s = new Set<number>();
  for (let i = 0; i < nodes.length; i++) {
    if (await predicate(nodes[i])) s.add(i);
  }
  return s;
}

async function coverageGuardForKind(
  raw: CascadeNodeInfo[],
  auth: CascadeNodeInfo[],
  kind: "tenantScoped" | "shareable",
): Promise<string[]> {
  const keep = await nodeIndexSet(
    raw,
    async (n) =>
      (kind === "shareable" ? !isSensitive(n.table) : true) &&
      await tableHasField(n.table, "tenantIds"),
  );
  return buildCoverageGuard(
    raw,
    auth,
    "common.error.cascadeUnauthorized",
    (_r, _a, i) => keep.has(i),
  );
}

// ============================================================================
// Share authority SQL
// ============================================================================

function callerPermsForFieldsSQL(
  recordRef: string,
  callerMatchSQL: string,
  targetFieldsExpr: string,
  isOwnerVar?: string,
  currentTenantIdsExpr?: string,
): string {
  const ownerValid = currentTenantIdsExpr
    ? `\n        AND ownerTenantIds CONTAINSANY ${currentTenantIdsExpr}`
    : "";
  const lookup = `array::flatten(
      SELECT VALUE permissions FROM shared_record
      WHERE recordId = ${recordRef}
        AND accessesTenantIds CONTAINSANY ${callerMatchSQL}${ownerValid}
        AND (IF set::len(${targetFieldsExpr}) = 0
             THEN set::len(fields) = 0
             ELSE set::len(fields) = 0 OR fields CONTAINSALL ${targetFieldsExpr}
             END)
    )`;
  return isOwnerVar
    ? `IF ${isOwnerVar} THEN {"r", "w", "share"} ELSE ${lookup} END`
    : lookup;
}

function callerCanShareFieldsSQL(
  recordRef: string,
  callerMatchSQL: string,
  targetFieldsExpr: string,
  isOwnerVar: string,
  currentTenantIdsExpr?: string,
): string {
  const ownerValid = currentTenantIdsExpr
    ? `\n          AND ownerTenantIds CONTAINSANY ${currentTenantIdsExpr}`
    : "";
  return `IF ${isOwnerVar}
      THEN true
      ELSE count(
        SELECT id FROM shared_record
        WHERE recordId = ${recordRef}
          AND accessesTenantIds CONTAINSANY ${callerMatchSQL}${ownerValid}
          AND permissions CONTAINS "share"
          AND (IF set::len(${targetFieldsExpr}) = 0
               THEN set::len(fields) = 0
               ELSE set::len(fields) = 0 OR fields CONTAINSALL ${targetFieldsExpr}
               END)
      ) > 0 END`;
}

function buildCascadeSharePropagationSQL(
  nodes: CascadeNodeInfo[],
  callerMatchSQL: string,
  rootOwnerVar: string,
  targetVar: string,
  permsVar: string,
  targetFieldsVar: string,
  rootRecordVar: string,
): string[] {
  return nodes.map((node) =>
    `FOR $__ccrec IN $${node.idsVar} {
    LET $__pTenantIds = <set>((SELECT VALUE tenantIds FROM ${node.table} WHERE id = $__ccrec LIMIT 1)[0] ?? []);
    LET $__pDirectOwnerTenant = set::intersect($__pTenantIds, ${callerMatchSQL})[0];
    LET $__pIsO = $__pDirectOwnerTenant != NONE;
    LET $__pShareAuth = IF $__pIsO THEN NONE ELSE (SELECT * FROM shared_record
        WHERE recordId = $__ccrec
          AND accessesTenantIds CONTAINSANY ${callerMatchSQL}
          AND ownerTenantIds CONTAINSANY $__pTenantIds
          AND permissions CONTAINS "share"
          AND (IF set::len(${targetFieldsVar}) = 0
               THEN set::len(fields) = 0
               ELSE set::len(fields) = 0 OR fields CONTAINSALL ${targetFieldsVar}
               END)
        LIMIT 1)[0] END;
    LET $__pActualOwnerTenant = IF $__pIsO THEN $__pDirectOwnerTenant ELSE IF $__pShareAuth = NONE THEN NONE ELSE set::intersect($__pShareAuth.ownerTenantIds, $__pTenantIds)[0] END END;
    LET $__pCP = ${
      callerPermsForFieldsSQL(
        "$__ccrec",
        callerMatchSQL,
        targetFieldsVar,
        "$__pIsO",
        "$__pTenantIds",
      )
    };
    LET $__pAllowed = IF $__pIsO THEN ${permsVar} ELSE set::intersect(${permsVar}, $__pCP) END;
    LET $__pFOk = ${
      callerCanShareFieldsSQL(
        "$__ccrec",
        callerMatchSQL,
        targetFieldsVar,
        "$__pIsO",
        "$__pTenantIds",
      )
    };
    IF ${rootOwnerVar} != NONE AND ${targetVar} != NONE AND $__pActualOwnerTenant != NONE
       AND ($__pIsO OR $__pCP CONTAINS "share") AND set::len($__pAllowed) > 0 AND $__pFOk {
      CREATE shared_record SET
        recordId = $__ccrec,
        ownerTenantIds = {$__pActualOwnerTenant,},
        accessesTenantIds = {${targetVar},},
        permissions = $__pAllowed,
        fields = ${targetFieldsVar},
        propagationRootRecordId = ${rootRecordVar},
        propagationOwnerTenantIds = {${rootOwnerVar},},
        propagationAccessTenantIds = {${targetVar},};
    };
  };`
  );
}

function buildCascadeShareEditSQL(
  nodes: CascadeNodeInfo[],
  callerMatchSQL: string,
  rootSrVar: string,
  requestedPermsVar: string,
  effectivePermsVar: string,
  hasFieldUpdateVar: string,
  newFieldsInputVar: string,
): string[] {
  return nodes.map((node) =>
    `FOR $__ccrec IN $${node.idsVar} {
    LET $__ccSrs = (SELECT * FROM shared_record
        WHERE recordId = $__ccrec
          AND propagationRootRecordId = ${rootSrVar}.recordId
          AND propagationOwnerTenantIds = ${rootSrVar}.ownerTenantIds
          AND propagationAccessTenantIds = ${rootSrVar}.accessesTenantIds);
    FOR $__ccSr IN $__ccSrs {
      LET $__pIsDeleteRequest = set::len(${requestedPermsVar}) = 0;
      LET $__pTargetFields = IF $__pIsDeleteRequest
          THEN $__ccSr.fields
          ELSE IF ${hasFieldUpdateVar} THEN ${newFieldsInputVar} ELSE $__ccSr.fields END
        END;
      LET $__pTenantIds = <set>((SELECT VALUE tenantIds FROM ${node.table} WHERE id = $__ccrec LIMIT 1)[0] ?? []);
      LET $__pIsO = $__pTenantIds CONTAINSANY ${callerMatchSQL};
      LET $__pCP = ${
      callerPermsForFieldsSQL(
        "$__ccrec",
        callerMatchSQL,
        "$__pTargetFields",
        "$__pIsO",
        "$__pTenantIds",
      )
    };
      LET $__pFOk = ${
      callerCanShareFieldsSQL(
        "$__ccrec",
        callerMatchSQL,
        "$__pTargetFields",
        "$__pIsO",
        "$__pTenantIds",
      )
    };
      LET $__pCan = ($__pIsO OR $__pCP CONTAINS "share") AND $__pFOk;
      IF $__pCan {
        LET $__pNew = IF $__pIsDeleteRequest
            THEN []
            ELSE IF $__pIsO THEN ${effectivePermsVar} ELSE set::intersect(${effectivePermsVar}, $__pCP) END
          END;
        IF $__pFOk {
          IF $__pIsDeleteRequest {
            DELETE shared_record WHERE id = $__ccSr.id;
          } ELSE IF set::len($__pNew) > 0 {
            UPDATE shared_record SET permissions = $__pNew, fields = $__pTargetFields WHERE id = $__ccSr.id;
          };
        };
      };
    };
  };`
  );
}

function sharedRecordCleanupSQL(recordIdsExpr: string): string {
  return `DELETE FROM shared_record WHERE recordId IN ${recordIdsExpr};`;
}
function sharedRecordTenantCleanupSQL(
  recordIdsExpr: string,
  tenantIdsExpr: string,
): string {
  return `DELETE FROM shared_record
      WHERE recordId IN ${recordIdsExpr}
        AND (ownerTenantIds CONTAINSANY ${tenantIdsExpr} OR accessesTenantIds CONTAINSANY ${tenantIdsExpr});`;
}

// ============================================================================
// Permissions / share field validation
// ============================================================================

function sanitizePerms(ps: string[]): Permission[] {
  return ps.filter((p): p is Permission => VALID_PERMS.has(p as Permission));
}
function validatePermsStrict(
  ps: string[],
): { ok: true; permissions: Permission[] } | { ok: false } {
  if (!ps.length) return { ok: false };
  const p = sanitizePerms(ps);
  return p.length !== ps.length || !p.length
    ? { ok: false }
    : { ok: true, permissions: p };
}

async function validateShareFieldsForTree(
  rootTable: string,
  cascade: CascadeChild[] | undefined,
  fields: string[] | undefined,
  label: string,
): Promise<ValidationError[] | null> {
  if (!fields?.length) return null;
  const nested = fields.find((f) => f.includes("."));
  if (nested) {
    return [{
      field: label,
      errors: [`common.error.nestedShareFieldUnsupported:${nested}`],
    }];
  }
  for (const f of uniqueFields(fields)) {
    if (!(await tableHasField(rootTable, f))) {
      return [{
        field: label,
        errors: [`common.error.unknownShareField:${rootTable}.${f}`],
      }];
    }
  }
  if (cascade?.length) {
    return [{
      field: label,
      errors: ["common.error.fieldScopedCascadeShareUnsupported"],
    }];
  }
  return null;
}

// ============================================================================
// Admin invariant — unified
// ============================================================================

function buildAdminInvariantForUserIdsSQL(
  userIdsExpr: string,
  slot: string,
): string[] {
  return [
    `LET $__adminUserIds${slot} = ${userIdsExpr};`,
    `LET $__blocked${slot} = count(
        FOR $u IN $__adminUserIds${slot} {
          LET $__userAdminScopes${slot} = (FOR $t IN (SELECT * FROM tenant
              WHERE actorId = $u AND companyId != NONE AND systemId != NONE) {
                LET $__sysTid${slot} = (SELECT VALUE id FROM tenant
                    WHERE !actorId AND !companyId AND systemId = $t.systemId LIMIT 1)[0];
                LET $__adminRolesForTenant${slot} = (SELECT VALUE id FROM role
                    WHERE name = "admin" AND tenantIds CONTAINS $__sysTid${slot});
                LET $__actorRids${slot} = (SELECT VALUE resourceLimitId.roleIds
                    FROM user WHERE id = $u LIMIT 1)[0];
                IF $__actorRids${slot} != NONE AND $__actorRids${slot} CONTAINSANY $__adminRolesForTenant${slot} {
                  RETURN { id: $t.id, companyId: $t.companyId, systemId: $t.systemId };
                };
              });
          FOR $t IN ($__userAdminScopes${slot} ?? []) {
            LET $__others${slot} = count(
              FOR $o IN (SELECT * FROM tenant
                  WHERE actorId != NONE AND actorId NOT IN $__adminUserIds${slot}
                    AND companyId = $t.companyId AND systemId = $t.systemId) {
                LET $__osysTid${slot} = (SELECT VALUE id FROM tenant
                    WHERE !actorId AND !companyId AND systemId = $o.systemId LIMIT 1)[0];
                LET $__otherAdminRoles${slot} = (SELECT VALUE id FROM role
                    WHERE name = "admin" AND tenantIds CONTAINS $__osysTid${slot});
                LET $__oactorRids${slot} = (SELECT VALUE resourceLimitId.roleIds
                    FROM user WHERE id = $o.actorId LIMIT 1)[0];
                IF $__oactorRids${slot} != NONE AND $__oactorRids${slot} CONTAINSANY $__otherAdminRoles${slot} { RETURN $o.id; };
              }
            );
            IF $__others${slot} = 0 { RETURN true; };
          };
        }
      );`,
    `IF $__blocked${slot} > 0 THEN
        RETURN { success: false, errorKey: "users.error.lastAdminDelete" };
     END;`,
  ];
}

function buildAdminInvariantSQL(): string[] {
  return [
    `LET $__userAdminTenants = (FOR $t IN (SELECT * FROM tenant
        WHERE actorId = $id AND companyId != NONE AND systemId != NONE) {
          LET $__sysTid = (SELECT VALUE id FROM tenant
              WHERE !actorId AND !companyId AND systemId = $t.systemId LIMIT 1)[0];
          LET $__adminRolesForTenant = (SELECT VALUE id FROM role
              WHERE name = "admin" AND tenantIds CONTAINS $__sysTid);
          LET $__actorRids = (SELECT VALUE resourceLimitId.roleIds
              FROM user WHERE id = $id LIMIT 1)[0];
          IF $__actorRids != NONE AND $__actorRids CONTAINSANY $__adminRolesForTenant {
            RETURN { id: $t.id, companyId: $t.companyId, systemId: $t.systemId };
          };
        });`,
    `LET $__blocked = count(
        FOR $t IN ($__userAdminTenants ?? []) {
          LET $others = count(
            FOR $o IN (SELECT * FROM tenant
                WHERE actorId != NONE AND actorId != $id
                  AND companyId = $t.companyId AND systemId = $t.systemId) {
              LET $__osysTid = (SELECT VALUE id FROM tenant
                  WHERE !actorId AND !companyId AND systemId = $o.systemId LIMIT 1)[0];
              LET $__otherAdminRoles = (SELECT VALUE id FROM role
                  WHERE name = "admin" AND tenantIds CONTAINS $__osysTid);
              LET $__oactorRids = (SELECT VALUE resourceLimitId.roleIds
                  FROM user WHERE id = $o.actorId LIMIT 1)[0];
              IF $__oactorRids != NONE AND $__oactorRids CONTAINSANY $__otherAdminRoles { RETURN $o.id; };
            }
          );
          IF $others = 0 { RETURN true; }
        }
      );`,
    `IF $__blocked > 0 THEN
        RETURN { success: false, deleted: false, orphaned: false, errorKey: "users.error.lastAdminDelete" };
     END;`,
  ];
}

function buildTenantIdsAdminGuardSQL(
  tenantIdsExpr: string,
  slot: string,
): string[] {
  return [
    `LET $__td_ids${slot} = ${tenantIdsExpr};`,
    `LET $__td_doomed${slot} = (FOR $t IN (SELECT * FROM tenant
        WHERE id IN $__td_ids${slot} AND actorId != NONE AND companyId != NONE AND systemId != NONE) {
          LET $__sysTid${slot} = (SELECT VALUE id FROM tenant
              WHERE !actorId AND !companyId AND systemId = $t.systemId LIMIT 1)[0];
          LET $__adminRolesForTenant${slot} = (SELECT VALUE id FROM role
              WHERE name = "admin" AND tenantIds CONTAINS $__sysTid${slot});
          LET $__td_arids${slot} = (SELECT VALUE resourceLimitId.roleIds
              FROM user WHERE id = $t.actorId LIMIT 1)[0];
          IF $__td_arids${slot} != NONE AND $__td_arids${slot} CONTAINSANY $__adminRolesForTenant${slot} {
            RETURN [$t.id, $t.companyId, $t.systemId];
          };
        });`,
    `LET $__td_blk${slot} = count(
        FOR $s IN ($__td_doomed${slot} ?? []) {
          LET $__td_sv${slot} = count(
            FOR $o IN (SELECT * FROM tenant
                WHERE actorId != NONE AND companyId = $s[1] AND systemId = $s[2]
                  AND id NOT IN $__td_ids${slot}) {
              LET $__osysTid${slot} = (SELECT VALUE id FROM tenant
                  WHERE !actorId AND !companyId AND systemId = $o.systemId LIMIT 1)[0];
              LET $__otherAdminRoles${slot} = (SELECT VALUE id FROM role
                  WHERE name = "admin" AND tenantIds CONTAINS $__osysTid${slot});
              LET $__oarids${slot} = (SELECT VALUE resourceLimitId.roleIds
                  FROM user WHERE id = $o.actorId LIMIT 1)[0];
              IF $__oarids${slot} != NONE AND $__oarids${slot} CONTAINSANY $__otherAdminRoles${slot} { RETURN $o.id; };
            }
          );
          IF $__td_sv${slot} = 0 { RETURN true; }
        }
      );`,
    `IF $__td_blk${slot} > 0 THEN
        RETURN { success: false, deleted: false, orphaned: false, errorKey: "users.error.lastAdminDelete" };
     END;`,
  ];
}

function buildRoleIdsAdminGuardSQL(
  roleIdsExpr: string,
  slot: string,
): string[] {
  return [
    `LET $__rd_ids${slot} = ${roleIdsExpr};`,
    `LET $__rd_doomed${slot} = (FOR $r IN (SELECT * FROM role
        WHERE id IN $__rd_ids${slot} AND name = "admin") {
          FOR $sysT IN (SELECT * FROM tenant WHERE id IN $r.tenantIds
              AND !actorId AND systemId != NONE) {
            FOR $t IN (SELECT * FROM tenant
                WHERE actorId != NONE AND companyId != NONE
                  AND systemId = $sysT.systemId) {
              LET $__rd_arids${slot} = (SELECT VALUE resourceLimitId.roleIds
                  FROM user WHERE id = $t.actorId LIMIT 1)[0];
              IF $__rd_arids${slot} != NONE AND $__rd_arids${slot} CONTAINS $r.id {
                RETURN [$t.id, $t.companyId, $sysT.systemId];
              };
            };
          };
        });`,
    `LET $__rd_blk${slot} = count(
        FOR $s IN ($__rd_doomed${slot} ?? []) {
          LET $__rd_sv${slot} = count(
            FOR $o IN (SELECT * FROM tenant
                WHERE actorId != NONE AND companyId = $s[1] AND systemId = $s[2]
                  AND id != $s[0]) {
              LET $__osysTid${slot} = (SELECT VALUE id FROM tenant
                  WHERE !actorId AND !companyId AND systemId = $o.systemId LIMIT 1)[0];
              LET $__otherAdminRoles${slot} = (SELECT VALUE id FROM role
                  WHERE name = "admin" AND tenantIds CONTAINS $__osysTid${slot});
              LET $__oarids${slot} = (SELECT VALUE resourceLimitId.roleIds
                  FROM user WHERE id = $o.actorId LIMIT 1)[0];
              IF $__oarids${slot} != NONE AND $__oarids${slot} CONTAINSANY $__otherAdminRoles${slot} { RETURN $o.id; };
            }
          );
          IF $__rd_sv${slot} = 0 { RETURN true; }
        }
      );`,
    `IF $__rd_blk${slot} > 0 THEN
        RETURN { success: false, deleted: false, orphaned: false, errorKey: "users.error.lastAdminDelete" };
     END;`,
  ];
}

// ============================================================================
// Cascade create data — validation + SQL
// ============================================================================

async function validateCascadeCreateData(
  cascade: CascadeChild[],
  data: CascadeCreateChild[] | undefined,
  path: string,
): Promise<
  { ok: true; data: CascadeCreateChild[] } | {
    ok: false;
    errors: ValidationError[];
  }
> {
  if (!data?.length) return { ok: true, data: [] };
  const out: CascadeCreateChild[] = [];
  const used = new Set<number>();

  for (const entry of data) {
    const match = findCascadeMatch(entry, cascade, used);
    if (!match.spec || match.index === undefined) {
      return {
        ok: false,
        errors: [{
          field: `${path}.${cascadeLabel(entry)}`,
          errors: [match.error ?? "common.error.cascadeTableUnknown"],
        }],
      };
    }
    used.add(match.index);
    const spec = match.spec;

    if (spec.sourceField && !spec.isArray && entry.rows.length > 1) {
      return {
        ok: false,
        errors: [{
          field: `${path}.${cascadeLabel(entry)}.rows`,
          errors: ["common.error.scalarSourceFieldAcceptsSingleRow"],
        }],
      };
    }

    const rows: Record<string, unknown>[] = [];
    for (let i = 0; i < entry.rows.length; i++) {
      const sv = await standardizeAndValidate(
        entry.fields ?? [],
        entry.rows[i],
        false,
      );
      if (sv.ok === false) {
        return {
          ok: false,
          errors: sv.errors.map((e) => ({
            ...e,
            field: `${path}.${cascadeLabel(entry)}[${i}].${e.field}`,
          })),
        };
      }
      if (!explicitFields(sv.data).length) {
        return {
          ok: false,
          errors: [{
            field: `${path}.${cascadeLabel(entry)}[${i}]`,
            errors: ["common.error.noFieldsToCreate"],
          }],
        };
      }
      rows.push(sv.data);
    }

    let children: CascadeCreateChild[] = [];
    if (entry.children?.length) {
      if (!spec.children?.length) {
        return {
          ok: false,
          errors: [{
            field: `${path}.${cascadeLabel(entry)}.children`,
            errors: ["common.error.cascadeChildUnknown"],
          }],
        };
      }
      const nested = await validateCascadeCreateData(
        spec.children,
        entry.children,
        `${path}.${cascadeLabel(entry)}`,
      );
      if (nested.ok === false) return nested;
      children = nested.data;
    }

    const n = {
      table: entry.table,
      rows,
      fields: entry.fields,
      children,
    } as Keyed<CascadeCreateChild>;
    const k = cascadeKey(entry as Keyed<CascadeCreateChild>);
    if (k) n.key = k;
    out.push(n);
  }
  return { ok: true, data: out };
}

async function findTenantScopedCreateTable(
  data: CascadeCreateChild[] | undefined,
): Promise<string | null> {
  if (!data?.length) return null;
  for (const e of data) {
    if (await tableHasField(e.table, "tenantIds")) return e.table;
    const n = await findTenantScopedCreateTable(e.children);
    if (n) return n;
  }
  return null;
}

// buildCascadeCreateSQL returns three streams so the caller can emit them
// around its own parent CREATE:
//   preLets          — must run BEFORE the current-level parent CREATE
//                      (contains CREATEs for every sourceField-linked
//                       descendant, so required-FK fields on the parent
//                       are available).
//   parentSetClauses — SET fragments injected INTO the current-level parent
//                      CREATE (e.g. `resourceLimitId = $__cc_xxx.id`).
//   postLets         — run AFTER the current-level parent CREATE
//                      (parentField-linked descendants, classical flow).
// This replaces the previous "CREATE parent; CREATE child; UPDATE parent
// SET sourceField = $child.id" pattern, which could not satisfy required FKs.
async function buildCascadeCreateSQL(
  cascade: CascadeChild[],
  data: CascadeCreateChild[],
  parentRowVar: string,
  tenantVar: string | null,
  suffix: string,
): Promise<{
  preLets: string[];
  parentSetClauses: string[];
  postLets: string[];
  bindings: Record<string, unknown>;
}> {
  const preLets: string[] = [];
  const parentSetClauses: string[] = [];
  const postLets: string[] = [];
  const bindings: Record<string, unknown> = {};
  const used = new Set<number>();

  for (const entry of data) {
    const match = findCascadeMatch(entry, cascade, used);
    if (!match.spec || match.index === undefined) {
      // Defensive: validateCascadeCreateData already catches this; keep the
      // early-return in postLets to preserve prior behaviour.
      postLets.push(
        `RETURN { success: false, errorKey: "${
          match.error ?? "common.error.cascadeTableUnknown"
        }" };`,
      );
      continue;
    }
    used.add(match.index);
    const spec = match.spec;
    const hasT = await tableHasField(entry.table, "tenantIds");
    const isSource = !!spec.sourceField;

    const rowVars: string[] = [];

    for (let i = 0; i < entry.rows.length; i++) {
      const rowVar = `__cc_${suffix}_${cascadeLabel(entry)}_${i}`.replace(
        /[^A-Za-z0-9_]/g,
        "_",
      );
      const prefix = `${suffix}_${cascadeLabel(entry)}_${i}`.replace(
        /[^A-Za-z0-9_]/g,
        "_",
      );
      rowVars.push(rowVar);

      const cs = await buildSetClauses(entry.table, entry.rows[i], bindings, {
        isCreate: true,
        bindingPrefix: prefix,
      });
      if (hasT && tenantVar) cs.push(`tenantIds = {$${tenantVar},}`);

      // parentField: child holds FK → parent. Set on the child's CREATE
      // (child is created after the parent, so $parentRowVar exists).
      if (spec.parentField && !spec.sourceField) {
        const v = spec.isArray
          ? `{$${parentRowVar}.id,}`
          : `$${parentRowVar}.id`;
        cs.push(`${spec.parentField} = ${v}`);
      }

      // Recurse first: grandchildren can contribute pre-statements that must
      // run before THIS entry's CREATE, and SET clauses for THIS entry's
      // CREATE (if any of THIS entry's children link via sourceField).
      let nestedPre: string[] = [];
      let nestedSet: string[] = [];
      let nestedPost: string[] = [];
      if (entry.children?.length) {
        if (!spec.children?.length) {
          (isSource ? preLets : postLets).push(
            `RETURN { success: false, errorKey: "common.error.cascadeChildUnknown" };`,
          );
        } else {
          const n = await buildCascadeCreateSQL(
            spec.children,
            entry.children,
            rowVar,
            tenantVar,
            prefix,
          );
          nestedPre = n.preLets;
          nestedSet = n.parentSetClauses;
          nestedPost = n.postLets;
          Object.assign(bindings, n.bindings);
        }
      }
      cs.push(...nestedSet);

      const createStmt = `LET $${rowVar} = (CREATE ${entry.table} SET ${
        cs.join(", ")
      })[0];`;

      if (isSource) {
        // Parent holds FK → this row. Emit row CREATE BEFORE the current-level
        // parent's CREATE; its own sourceField-descendants already precede it
        // inside nestedPre. parentField-descendants run after.
        preLets.push(...nestedPre, createStmt);
        postLets.push(...nestedPost);
      } else {
        // parentField: standard downstream creation order.
        postLets.push(...nestedPre, createStmt, ...nestedPost);
      }
    }

    // Inject the sourceField FK(s) into the current-level parent's SET clause.
    if (isSource && rowVars.length) {
      if (spec.isArray) {
        parentSetClauses.push(
          `${spec.sourceField} = {${
            rowVars.map((v) => `$${v}.id`).join(", ")
          },}`,
        );
      } else {
        // Scalar sourceField: validation already enforces exactly one row.
        parentSetClauses.push(`${spec.sourceField} = $${rowVars[0]}.id`);
      }
    }
  }

  return { preLets, parentSetClauses, postLets, bindings };
}

// ============================================================================
// Cascade update data — validation + SQL
// ============================================================================

async function validateCascadeUpdateData(
  cascade: CascadeChild[],
  data: CascadeUpdateChild[] | undefined,
  path: string,
): Promise<
  { ok: true; data: CascadeUpdateChild[] } | {
    ok: false;
    errors: ValidationError[];
  }
> {
  if (!data?.length) return { ok: true, data: [] };
  const out: CascadeUpdateChild[] = [];
  const used = new Set<number>();

  for (const entry of data) {
    const match = findCascadeMatch(entry, cascade, used);
    if (!match.spec || match.index === undefined) {
      return {
        ok: false,
        errors: [{
          field: `${path}.${cascadeLabel(entry)}`,
          errors: [match.error ?? "common.error.cascadeTableUnknown"],
        }],
      };
    }
    used.add(match.index);
    const spec = match.spec;

    let children: CascadeUpdateChild[] = [];
    if (entry.children?.length) {
      if (!spec.children?.length) {
        return {
          ok: false,
          errors: [{
            field: `${path}.${cascadeLabel(entry)}.children`,
            errors: ["common.error.cascadeChildUnknown"],
          }],
        };
      }
      const nested = await validateCascadeUpdateData(
        spec.children,
        entry.children,
        `${path}.${cascadeLabel(entry)}`,
      );
      if (nested.ok === false) return nested;
      children = nested.data;
    }

    const raw = (entry.data ?? {}) as Record<string, unknown>;
    let processed: Record<string, unknown> = {};
    if (explicitFields(raw).length > 0) {
      const sv = await standardizeAndValidate(entry.fields ?? [], raw, true);
      if (sv.ok === false) {
        return {
          ok: false,
          errors: sv.errors.map((e) => ({
            ...e,
            field: `${path}.${cascadeLabel(entry)}.${e.field}`,
          })),
        };
      }
      processed = sv.data;
    }
    if (!explicitFields(processed).length && !children.length) {
      return {
        ok: false,
        errors: [{
          field: `${path}.${cascadeLabel(entry)}`,
          errors: ["common.error.noFieldsToUpdate"],
        }],
      };
    }

    const n = {
      table: entry.table,
      data: processed,
      fields: entry.fields,
      children,
    } as Keyed<CascadeUpdateChild>;
    const k = cascadeKey(entry as Keyed<CascadeUpdateChild>);
    if (k) n.key = k;
    out.push(n);
  }
  return { ok: true, data: out };
}

async function buildCascadeUpdateSQL(
  cascade: CascadeChild[],
  data: CascadeUpdateChild[],
  rootTable: string,
  rootIdExpr: string,
  caller: Tenant | undefined,
  suffix: string,
  touchNonTargeted = false,
): Promise<
  {
    preflightLets: string[];
    mutationLets: string[];
    bindings: Record<string, unknown>;
  }
> {
  const preflight: string[] = [];
  const mutation: string[] = [];
  const bindings: Record<string, unknown> = {};

  const payloadBySlot = new Map<string, CascadeUpdateChild>();
  const fieldsBySlot = new Map<string, string[]>();
  let slot = 0;

  const walkPayloads = (
    children: CascadeChild[],
    payload: CascadeUpdateChild[],
  ) => {
    const used = new Set<number>();
    for (const c of children) {
      const slotKey = `ce_cu_${suffix}_${slot++}`;
      const ck = cascadeKey(c as KChild);
      let match: { payload?: CascadeUpdateChild; index?: number } = {};
      if (ck) {
        const i = payload.findIndex((e, idx) =>
          !used.has(idx) && cascadeKey(e as Keyed<CascadeUpdateChild>) === ck
        );
        if (i >= 0) match = { payload: payload[i], index: i };
      } else {
        const matches = payload.map((e, i) => ({ e, i })).filter(({ e, i }) =>
          !used.has(i) && !cascadeKey(e as Keyed<CascadeUpdateChild>) &&
          e.table === c.table
        );
        if (matches.length > 1) {
          throw new Error(`common.error.cascadePayloadKeyRequired:${c.table}`);
        }
        if (matches.length === 1) {
          match = { payload: matches[0].e, index: matches[0].i };
        }
      }
      if (match.index !== undefined) used.add(match.index);
      if (match.payload) {
        payloadBySlot.set(slotKey, match.payload);
        const f = explicitFields(match.payload.data);
        if (f.length) fieldsBySlot.set(slotKey, f);
      }
      walkPayloads(c.children ?? [], match.payload?.children ?? []);
    }
  };
  walkPayloads(cascade, data);

  const rawExp = await expandCascade(
    rootTable,
    rootIdExpr,
    cascade,
    undefined,
    "w",
    `cu_${suffix}_raw`,
    "raw",
  );
  const exp = await expandCascade(
    rootTable,
    rootIdExpr,
    cascade,
    caller,
    "w",
    `cu_${suffix}`,
    "any",
    fieldsBySlot,
  );
  preflight.push(...rawExp.lets, ...exp.lets);
  Object.assign(bindings, rawExp.bindings, exp.bindings);

  const guardIndexes = new Set<number>();
  for (let i = 0; i < exp.nodes.length; i++) {
    const n = exp.nodes[i];
    const slotKey = n.idsVar.replace(/^__cc_/, "");
    const payload = payloadBySlot.get(slotKey);
    const f = payload ? explicitFields(payload.data) : [];
    if (
      f.length ||
      (!payload && touchNonTargeted &&
        await tableHasField(n.table, "updatedAt"))
    ) guardIndexes.add(i);
  }
  preflight.push(
    ...buildCoverageGuard(
      rawExp.nodes,
      exp.nodes,
      "common.error.cascadeUnauthorized",
      (_r, _a, i) => guardIndexes.has(i),
    ),
  );

  for (const n of exp.nodes) {
    const slotKey = n.idsVar.replace(/^__cc_/, "");
    const payload = payloadBySlot.get(slotKey);
    if (!payload) {
      if (touchNonTargeted && await tableHasField(n.table, "updatedAt")) {
        mutation.push(
          `UPDATE ${n.table} SET updatedAt = time::now() WHERE id IN $${n.idsVar};`,
        );
      }
      continue;
    }
    const f = explicitFields(payload.data);
    if (!f.length) continue;
    const cs = await buildSetClauses(n.table, payload.data, bindings, {
      isCreate: false,
      bindingPrefix: `${suffix}_${n.idsVar}`,
    });
    if (!cs.length) continue;
    if (n.table === "tenant" && touchesAdminTenantFields(f)) {
      preflight.push(
        ...buildTenantIdsAdminGuardSQL(
          `$${n.idsVar}`,
          `_${suffix}_${n.idsVar}_tenant_admin`,
        ),
      );
    }
    if (n.table === "role" && touchesAdminRoleFields(f)) {
      preflight.push(
        ...buildRoleIdsAdminGuardSQL(
          `$${n.idsVar}`,
          `_${suffix}_${n.idsVar}_role_admin`,
        ),
      );
    }
    mutation.push(
      `UPDATE ${n.table} SET ${cs.join(", ")} WHERE id IN $${n.idsVar};`,
    );
  }

  return { preflightLets: preflight, mutationLets: mutation, bindings };
}

// ============================================================================
// Cascade tenant-mutation (associate/disassociate/orphan-delete) — unified
// ============================================================================

async function buildCascadeTenantMutation(
  rootTable: string,
  rootIdsVar: string,
  cascade: CascadeChild[] | undefined,
  caller: Tenant | undefined,
  op: "add" | "remove",
  tenantSetExpr: string,
  suffix: string,
): Promise<
  {
    lets: string[];
    collectorLets: string[];
    guardLets: string[];
    updateLets: string[];
    bindings: Record<string, unknown>;
    cascadedTables: string[];
    tenantScopedNodes: CascadeNodeInfo[];
  }
> {
  const collectorLets: string[] = [];
  const guardLets: string[] = [];
  const updateLets: string[] = [];
  const bindings: Record<string, unknown> = {};
  const cascadedTables: string[] = [];
  const tenantScopedNodes: CascadeNodeInfo[] = [];
  const setExpr = op === "add"
    ? `set::union(tenantIds, ${tenantSetExpr})`
    : `set::difference(tenantIds, ${tenantSetExpr})`;

  const planUpdate = async (table: string, idsVar: string, slot: string) => {
    const a = await buildAccessClause(
      table,
      caller,
      "w",
      slot,
      undefined,
      "tenant",
    );
    Object.assign(bindings, a.bindings);
    const where = [`id IN $${idsVar}`];
    if (a.clause) where.push(a.clause);

    if (op === "remove") {
      guardLets.push(
        `LET $${slot}_lastTenantRemoval = array::len((SELECT id FROM ${table}
            WHERE id IN $${idsVar}
              AND tenantIds CONTAINSANY ${tenantSetExpr}
              AND set::len(set::difference(tenantIds, ${tenantSetExpr})) = 0
          LIMIT 1));`,
      );
    }
    if (op === "remove" && table === "role") {
      guardLets.push(
        ...buildRoleIdsAdminGuardSQL(`$${idsVar}`, `${slot}_role_admin`),
      );
    }
    updateLets.push(
      `UPDATE ${table} SET tenantIds = ${setExpr} WHERE ${
        where.join(" AND ")
      };`,
    );
  };

  if (cascade?.length) {
    const rawCol = await collectCascadeIds(
      cascade,
      rootTable,
      rootIdsVar,
      undefined,
      "w",
      `${suffix}_tmut_raw`,
      "raw",
    );
    const col = await collectCascadeIds(
      cascade,
      rootTable,
      rootIdsVar,
      caller,
      "w",
      `${suffix}_tmut`,
      "tenant",
    );
    collectorLets.push(...rawCol.lets, ...col.lets);
    Object.assign(bindings, rawCol.bindings, col.bindings);
    guardLets.push(
      ...await coverageGuardForKind(rawCol.nodes, col.nodes, "tenantScoped"),
    );
    for (const n of col.nodes) {
      if (!(await tableHasField(n.table, "tenantIds"))) continue;
      await planUpdate(n.table, n.idsVar, `_ct_${suffix}_${n.idsVar}`);
      cascadedTables.push(n.table);
      tenantScopedNodes.push(n);
    }
  }
  if (await tableHasField(rootTable, "tenantIds")) {
    await planUpdate(rootTable, rootIdsVar, `_ct_${suffix}_root`);
  }
  return {
    lets: [...collectorLets, ...guardLets, ...updateLets],
    collectorLets,
    guardLets,
    updateLets,
    bindings,
    cascadedTables,
    tenantScopedNodes,
  };
}

// ============================================================================
// List filters (root) — uses shared buildFilterBlock
// ============================================================================

async function buildListFilters(
  opts: ListOptsLike,
  readFields?: string[],
  skipAccess = false,
): Promise<{ conds: string[]; bindings: Record<string, unknown> }> {
  const conds: string[] = [];
  const bindings: Record<string, unknown> = {};

  const block = await buildFilterBlock(opts, "root", "genericList");
  conds.push(...block.conds);
  Object.assign(bindings, block.bindings);

  const access = skipAccess
    ? { clause: "", bindings: {} }
    : await buildAccessClause(
      opts.table,
      opts.tenant,
      "r",
      "",
      readFields,
      "any",
    );
  if (access.clause) {
    conds.push(access.clause);
    Object.assign(bindings, access.bindings);
  }
  return { conds, bindings };
}

async function buildCascadeCountAccessFields(
  cascade: CascadeChild[] | undefined,
  caller: Tenant | undefined,
  suffix: string,
): Promise<Map<string, string[]> | undefined> {
  if (!cascade?.length || !caller) return undefined;
  const m = new Map<string, string[]>();
  let slot = 0;
  const walk = async (cs: CascadeChild[]) => {
    for (const c of cs) {
      const key = `${suffix}_${slot++}`;
      if (await tableHasField(c.table, "tenantIds")) {
        const ext = c as KChild;
        const base = ext.countAccessFields ?? ext.accessFields ??
          parseSelectFields(ext.select) ?? [];
        const fromLO = listOptionsFields(getListOptions(c));
        const eff = uniqueFields([...base, ...fromLO]).filter((x) =>
          x !== "id"
        );
        if (!eff.length) {
          throw new Error(
            `common.error.cascadeCountRequiresAccessFields:${c.table}`,
          );
        }
        m.set(key, eff);
      }
      if (c.children?.length) await walk(c.children);
    }
  };
  await walk(cascade);
  return m;
}

// ============================================================================
// Read-cascade planner / distributor
// ============================================================================

async function planCascade(
  children: CascadeChild[],
  parentVar: string,
  builder: CascadeBuilder,
  caller: Tenant | undefined,
  parentReadFields?: string[],
  skipAccess?: boolean,
): Promise<ReadPlan[]> {
  const plans: ReadPlan[] = [];
  for (const child of children) {
    const src = child.sourceField, pf = child.parentField;
    if (!src && !pf) continue;
    const isParentLink = !src && !!pf;
    const attachField = cascadeKey(child as KChild) ?? src ?? child.table;

    if (parentReadFields) {
      const req = isParentLink ? "id" : src!;
      if (!parentReadFields.includes(req)) {
        throw new Error(`common.error.cascadeReadRequiresSourceField:${req}`);
      }
    }

    const varName = `__c${builder.counter.n++}`;
    const isArray = child.isArray ?? false;
    const ext = child as KChild;
    const resultIsArray = ext.resultIsArray ?? (isParentLink ? true : isArray);
    const lo = getListOptions(child);

    // Per-child listOptions filter (contributes fields to access scope).
    const filter = await buildFilterBlock(
      lo,
      `plan_${varName}`,
      `cascade.${child.table}.listOptions`,
    );
    Object.assign(builder.bindings, filter.bindings);

    const read = await buildReadAccess(
      child.table,
      caller,
      `_${varName}`,
      ext.select,
      filter.fields,
      skipAccess,
    );
    if (read.readFields && !read.readFields.includes("id")) {
      throw new Error(`common.error.cascadeReadRequiresId:${child.table}`);
    }
    if (isParentLink && read.readFields && !read.readFields.includes(pf!)) {
      throw new Error(
        `common.error.cascadeReadRequiresParentField:${child.table}.${pf}`,
      );
    }
    Object.assign(builder.bindings, read.bindings);

    const conds: string[] = [];
    if (src) {
      if (isArray) {
        conds.push(`array::any(${parentVar}, |$p| id IN $p.${src})`);
      } else {
        conds.push(`id IN ${parentVar}.${src}`);
      }
    } else {
      const op = isArray ? "CONTAINSANY" : "IN";
      conds.push(`${pf} ${op} ${parentVar}.id`);
    }
    if (read.clause) conds.push(read.clause);
    conds.push(...filter.conds);

    // Optional ordering and limit from child listOptions.
    let tail = "";
    if (lo?.orderBy) {
      const parsed = parseOrderBy(lo.orderBy, "id");
      if (read.readFields) {
        for (const f of orderByFields(parsed)) {
          if (!read.readFields.includes(f)) {
            throw new Error(
              `common.error.cascadeReadOrderFieldNotSelected:${child.table}.${f}`,
            );
          }
        }
      }
      tail += ` ORDER BY ${orderBySQL(parsed)}`;
    }
    if (typeof lo?.limit === "number" && Number.isFinite(lo.limit)) {
      tail += ` LIMIT ${Math.max(1, Math.trunc(lo.limit))}`;
    }

    builder.letStatements.push(
      `LET $${varName} = SELECT ${read.selectSql} FROM ${child.table} WHERE ${
        conds.join(" AND ")
      }${tail};`,
    );
    builder.returnFields.push(`${varName}: $${varName}`);

    const nested = child.children?.length
      ? await planCascade(
        child.children,
        `$${varName}`,
        builder,
        caller,
        read.readFields,
        skipAccess,
      )
      : [];
    plans.push(
      {
        sourceField: src,
        parentField: pf,
        attachField,
        varName,
        isArray,
        isParentLink,
        resultIsArray,
        children: nested,
      } as ReadPlan,
    );
  }
  return plans;
}

function distributeCascade(
  parents: Record<string, unknown>[],
  data: Record<string, unknown>,
  plans: ReadPlan[],
): void {
  for (const plan of plans) {
    const loaded = (data[plan.varName] as Record<string, unknown>[]) ?? [];
    if (plan.isParentLink && plan.parentField) {
      for (const parent of parents) {
        const slot =
          ((parent as WithCascade<Record<string, unknown>>)._cascade ??= {});
        const m = loaded.filter((r) =>
          valueContainsId(getPath(r, plan.parentField!), parent.id)
        );
        slot[plan.attachField] = plan.resultIsArray ? m : m[0] ?? null;
      }
    } else if (plan.sourceField) {
      const byId = new Map<string, Record<string, unknown>>();
      for (const r of loaded) byId.set(stringifyId(r.id), r);
      for (const parent of parents) {
        const v = getPath(parent, plan.sourceField);
        const slot =
          ((parent as WithCascade<Record<string, unknown>>)._cascade ??= {});
        if (v == null) slot[plan.attachField] = plan.resultIsArray ? [] : null;
        else if (Array.isArray(v) || v instanceof Set) {
          const arr = v instanceof Set ? [...v] : v;
          slot[plan.attachField] = arr.map((id) => byId.get(stringifyId(id)))
            .filter((x): x is Record<string, unknown> => x != null);
        } else {
          slot[plan.attachField] = plan.resultIsArray
            ? [byId.get(stringifyId(v))].filter((
              x,
            ): x is Record<string, unknown> => x != null)
            : byId.get(stringifyId(v)) ?? null;
        }
      }
    }
    if (plan.children.length && loaded.length) {
      distributeCascade(loaded, data, plan.children);
    }
  }
}

function ensureSelectedFieldsContain(
  sel: string[] | undefined,
  req: string[],
  prefix: string,
): void {
  if (!sel) return;
  for (const f of req) if (!sel.includes(f)) throw new Error(`${prefix}:${f}`);
}

// ============================================================================
// Preflight helper for mutation-style public methods
// ============================================================================

async function mutationPreflight(
  opts: GenericCrudOptions,
  priv?: PrivOpt,
): Promise<{ success: false; errors: ValidationError[] } | null> {
  const e1 = await getTableError(opts.table, "mutation", priv);
  if (e1) return failV("table", e1);
  const e2 = await getCascadeTableError(opts.cascade, "mutation", priv);
  if (e2) return failV("cascade", e2);
  return null;
}

// ============================================================================
// ============================================================================
// PUBLIC METHODS
// ============================================================================
// ============================================================================

// ----------------------------------------------------------------------------
// LIST
// ----------------------------------------------------------------------------

export async function genericList<T = Record<string, unknown>>(
  opts: GenericListOptions & PrivOpt & RawCondOpt & ExtraAccOpt,
): Promise<PaginatedResult<WithCascade<T>>> {
  assertSafeListish(opts as ListOptsLike, "genericList", true);
  if (await getTableError(opts.table, "read", opts)) {
    return { items: [], total: 0, hasMore: false, nextCursor: undefined };
  }
  if (await getCascadeTableError(opts.cascade, "read", opts)) {
    return { items: [], total: 0, hasMore: false, nextCursor: undefined };
  }

  const select = (opts as { select?: SelectSpec }).select as SelectSpec;
  const parsedOrder = parseOrderBy(opts.orderBy, "id");
  const cursorField = parsedOrder[0].field;
  const cursorDirection = parsedOrder[0].direction;

  const selectedFields = parseSelectFields(select);
  const listAccessFields = await buildListAccessFields(
    opts as ListOptsLike,
    selectedFields,
    true,
  );
  const skipAccess = opts.skipAccessCheck === true;
  const read = await buildReadAccess(
    opts.table,
    opts.tenant,
    "",
    select,
    listAccessFields,
    skipAccess,
  );
  ensureSelectedFieldsContain(
    read.readFields,
    [cursorField, ...orderByFields(parsedOrder)],
    "common.error.readRequiresOrderField",
  );

  const { conds: base, bindings } = await buildListFilters(
    opts as ListOptsLike,
    read.accessFields,
    skipAccess,
  );
  Object.assign(bindings, read.bindings);

  const limit = Math.max(1, opts.limit ?? 20);
  const itemConds = [...base];
  if (opts.cursor) {
    itemConds.push(
      `${cursorField} ${cursorDirection === "ASC" ? ">" : "<"} $__cursor`,
    );
    bindings.__cursor = opts.cursor.includes(":")
      ? rid(opts.cursor)
      : opts.cursor;
  }

  const baseWhere = base.length ? ` WHERE ${base.join(" AND ")}` : "";
  const itemWhere = itemConds.length ? ` WHERE ${itemConds.join(" AND ")}` : "";

  const itemsSelect =
    `SELECT ${read.selectSql} FROM ${opts.table}${itemWhere}` +
    ` ORDER BY ${orderBySQL(parsedOrder)} LIMIT ${limit + 1}`;
  const countSelect =
    `SELECT count() AS c FROM ${opts.table}${baseWhere} GROUP ALL`;

  const builder: CascadeBuilder = {
    letStatements: [],
    returnFields: [],
    bindings,
    counter: { n: 0 },
  };
  const plans = opts.cascade?.length
    ? await planCascade(
      opts.cascade,
      "$__items",
      builder,
      opts.tenant,
      read.readFields,
      skipAccess,
    )
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
  const res = await db.query<unknown[]>(query, bindings);
  const final = (res[res.length - 1] ?? {}) as {
    items?: Record<string, unknown>[];
    total?: number;
    [k: string]: unknown;
  };
  let items = final.items ?? [];
  items = items.map((item) => setsToArrays(item));
  const total = final.total ?? 0;
  const hasMore = items.length > limit;
  if (hasMore) items = items.slice(0, limit);
  let nextCursor: string | undefined;
  if (hasMore && items.length) {
    const cv = items[items.length - 1][cursorField];
    if (cv != null) nextCursor = stringifyId(cv);
  }
  if (plans.length && items.length) distributeCascade(items, final, plans);
  return {
    items: items as WithCascade<T>[],
    total,
    hasMore,
    nextCursor,
  } as PaginatedResult<WithCascade<T>>;
}

// ----------------------------------------------------------------------------
// GET BY ID
// ----------------------------------------------------------------------------

export async function genericGetById<T = Record<string, unknown>>(
  opts: GenericCrudOptions & { select?: SelectSpec } & PrivOpt,
  id: string,
): Promise<WithCascade<T> | null> {
  assertSafeCrud(opts, "genericGetById");
  if (await getTableError(opts.table, "read", opts)) return null;
  if (await getCascadeTableError(opts.cascade, "read", opts)) return null;

  const bindings: Record<string, unknown> = { id: rid(id) };
  const read = await buildReadAccess(
    opts.table,
    opts.tenant,
    "_get",
    opts.select,
  );
  const idWhere = await buildIdAccessWhere(
    opts.table,
    "id",
    opts.tenant,
    "r",
    "_get",
    "any",
    read.accessFields,
    opts.skipAccessCheck === true,
  );
  Object.assign(bindings, read.bindings, idWhere.bindings);

  const entitySelect = `SELECT ${read.selectSql} FROM ${opts.table} WHERE ${
    idWhere.where.join(" AND ")
  } LIMIT 1`;

  const builder: CascadeBuilder = {
    letStatements: [],
    returnFields: [],
    bindings,
    counter: { n: 0 },
  };
  const plans = opts.cascade?.length
    ? await planCascade(
      opts.cascade,
      "$__entity",
      builder,
      opts.tenant,
      read.readFields,
      opts.skipAccessCheck === true,
    )
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
  const res = await db.query<unknown[]>(query, bindings);
  const final = (res[res.length - 1] ?? {}) as {
    entity?: Record<string, unknown> | null;
    [k: string]: unknown;
  };
  const entity = final.entity ?? null;
  if (!entity) return null;
  if (plans.length) distributeCascade([entity], final, plans);
  return setsToArrays(entity) as WithCascade<T>;
}

// ----------------------------------------------------------------------------
// CREATE
// ----------------------------------------------------------------------------

export async function genericCreate<T = Record<string, unknown>>(
  opts: GenericCrudOptions & TenantCreateOpt & PrivOpt & {
    initialShares?: {
      accessTenant: Tenant;
      permissions: string[];
      fields?: string[];
    }[];
    cascadeData?: CascadeCreateChild[];
  },
  data: Record<string, unknown>,
): Promise<GenericResult<T>> {
  assertSafeCrud(opts, "genericCreate");
  const err = await mutationPreflight(opts, opts);
  if (err) return err;

  let processed: Record<string, unknown>;
  if (opts.skipFieldPipeline) {
    processed = { ...data };
  } else {
    const sv = await standardizeAndValidate(opts.fields ?? [], data, false);
    if (sv.ok === false) return { success: false, errors: sv.errors };
    processed = sv.data;
  }
  if (!explicitFields(processed).length) {
    return failV("root", "common.error.noFieldsToCreate");
  }

  let cascadeProcessed: CascadeCreateChild[] | undefined;
  if (opts.cascadeData?.length) {
    if (!opts.cascade?.length) {
      return failV("cascadeData", "common.error.cascadeMissing");
    }
    const cv = await validateCascadeCreateData(
      opts.cascade,
      opts.cascadeData,
      "cascadeData",
    );
    if (cv.ok === false) return { success: false, errors: cv.errors };
    cascadeProcessed = cv.data;
  }

  const bindings: Record<string, unknown> = {};
  const lets: string[] = [];

  const hasT = await tableHasField(opts.table, "tenantIds");
  if (hasT && !hasTenantSelector(opts.tenant)) {
    return { success: false, errors: tenantSelectorErr() };
  }

  type ValidShare = {
    ok: true;
    index: number;
    accessTenant: Tenant;
    permissions: Permission[];
    fields: string[];
  };
  type InvalidShare = {
    ok: false;
    index: number;
    field: string;
    error: string;
  };
  const shares: (ValidShare | InvalidShare)[] = (opts.initialShares ?? []).map(
    (s, i) => {
      if (!hasTenantSelector(s.accessTenant)) {
        return {
          ok: false,
          index: i,
          field: `initialShares[${i}].accessTenant`,
          error: "common.error.tenantSelectorRequired",
        };
      }
      if (!s.accessTenant.id) {
        return {
          ok: false,
          index: i,
          field: `initialShares[${i}].accessTenant`,
          error: "common.error.existingTenantIdRequired",
        };
      }
      try {
        if (s.fields) {
          assertSafeFieldPaths(s.fields, `initialShares[${i}].fields`);
        }
      } catch {
        return {
          ok: false,
          index: i,
          field: `initialShares[${i}].fields`,
          error: "common.error.unsafeField",
        };
      }
      const c = validatePermsStrict(s.permissions);
      if (!c.ok) {
        return {
          ok: false,
          index: i,
          field: `initialShares[${i}].permissions`,
          error: "common.error.invalidPermissions",
        };
      }
      return {
        ok: true,
        index: i,
        accessTenant: s.accessTenant,
        permissions: c.permissions,
        fields: s.fields ?? [],
      };
    },
  );
  const bad = shares.find((s): s is InvalidShare => !s.ok);
  if (bad) return failV(bad.field, bad.error);

  const tenantScopedCreateTable = await findTenantScopedCreateTable(
    cascadeProcessed,
  );

  if (shares.length && !hasT) {
    return failV("initialShares", "common.error.notSupported");
  }
  if (shares.length && isSensitive(opts.table)) {
    return failV("initialShares", "common.error.securityTableNotShareable");
  }

  for (const s of shares) {
    if (!s.ok) continue;
    const fe = await validateShareFieldsForTree(
      opts.table,
      opts.cascade,
      s.fields,
      `initialShares[${s.index}].fields`,
    );
    if (fe) return { success: false, errors: fe };
  }

  if (tenantScopedCreateTable && !hasTenantSelector(opts.tenant)) {
    return failV(
      `cascadeData.${tenantScopedCreateTable}.tenant`,
      "common.error.tenantSelectorRequired",
    );
  }

  let tenantVar: string | null = null;
  if ((hasT || tenantScopedCreateTable) && opts.tenant) {
    if (!opts.tenant.id && !opts.allowCreateCallerTenant) {
      return failV("tenant", "common.error.existingTenantIdRequired");
    }
    const tr = resolveTenantLET(opts.tenant, "__ct", "resolveOrCreate");
    lets.push(...tr.lets, tenantResolvedGuard("__ct", "tenant"));
    Object.assign(bindings, tr.bindings);
    tenantVar = "__ct";
  }

  shares.forEach((s, i) => {
    if (!s.ok) return;
    const v = `__as${i}`;
    const tr = resolveTenantLET(s.accessTenant, v, "existing");
    lets.push(
      ...tr.lets,
      tenantResolvedGuard(v, `initialShares[${i}].accessTenant`),
    );
    Object.assign(bindings, tr.bindings);
  });

  const setClauses = await buildSetClauses(opts.table, processed, bindings, {
    isCreate: true,
  });
  if (tenantVar) setClauses.push(`tenantIds = {$${tenantVar},}`);
  if (!setClauses.length) return failV("root", "common.error.noFieldsToCreate");

  // Cascade build must run BEFORE the root CREATE so that:
  //   · sourceField-linked descendants can be CREATEd first (preLets), and
  //   · their ids can be injected into the root's SET clause
  //     (parentSetClauses). This is what lets required FKs on the root
  //     (e.g. api_token.resourceLimitId TYPE record<resource_limit>) be
  //     satisfied in a single batched query, without a transaction and
  //     without a post-hoc UPDATE.
  // parentField-linked descendants continue to be emitted after the root
  // CREATE (postLets), exactly as before.
  let cascadePostLets: string[] = [];
  if (cascadeProcessed?.length && opts.cascade?.length) {
    const cc = await buildCascadeCreateSQL(
      opts.cascade,
      cascadeProcessed,
      "__created",
      tenantVar,
      "crd",
    );
    lets.push(...cc.preLets);
    setClauses.push(...cc.parentSetClauses);
    cascadePostLets = cc.postLets;
    Object.assign(bindings, cc.bindings);
  }

  lets.push(
    `LET $__created = (CREATE ${opts.table} SET ${setClauses.join(", ")})[0];`,
  );
  lets.push(...cascadePostLets);

  if (shares.length && tenantVar) {
    shares.forEach((s, i) => {
      if (!s.ok) return;
      bindings[`__sp${i}`] = s.permissions;
      bindings[`__sf${i}`] = s.fields;
      lets.push(
        `CREATE shared_record SET
           recordId = $__created.id,
           ownerTenantIds = {$${tenantVar},},
           accessesTenantIds = {$__as${i},},
           permissions = $__sp${i},
           fields = $__sf${i};`,
      );
    });
    if (opts.cascade?.length) {
      lets.push(`LET $__rootIdSet = [$__created.id];`);
      const cm = buildCallerTenantsSQL(opts.tenant, "_cr");
      Object.assign(bindings, cm.bindings);
      const col = await collectCascadeIds(
        opts.cascade,
        opts.table,
        "__rootIdSet",
        opts.tenant,
        "share",
        "cr",
        "any",
      );
      lets.push(...col.lets);
      Object.assign(bindings, col.bindings);
      const shareNodes = await filterNodes(col.nodes, "shareable");
      shares.forEach((_, i) => {
        lets.push(...buildCascadeSharePropagationSQL(
          shareNodes,
          cm.sql,
          `$${tenantVar}`,
          `$__as${i}`,
          `$__sp${i}`,
          `$__sf${i}`,
          "$__created.id",
        ));
      });
    }
  }

  lets.push(`RETURN { id: $__created.id };`);

  const db = await getDb();
  const res = await db.query<unknown[]>(lets.join("\n"), bindings);
  const final = res[res.length - 1];
  if (isGenericFailure(final)) {
    const m = final as { errors?: ValidationError[]; errorKey?: string };
    return {
      success: false,
      errors: m.errors ?? valErr("root", m.errorKey ?? "common.error.generic"),
    };
  }
  const created = setsToArrays(final) as T | undefined;
  if (!created) return failV("root", "common.error.generic");
  return { success: true, data: created };
}

// ----------------------------------------------------------------------------
// UPDATE
// ----------------------------------------------------------------------------

export async function genericUpdate<T = Record<string, unknown>>(
  opts: GenericCrudOptions & CascadeUpdOpt & PrivOpt & {
    cascadeData?: CascadeUpdateChild[];
  },
  id: string,
  data: Record<string, unknown>,
): Promise<GenericResult<T>> {
  assertSafeCrud(opts, "genericUpdate");
  if (opts.cascadeGateFields) {
    assertSafeFieldPaths(
      opts.cascadeGateFields,
      "genericUpdate.cascadeGateFields",
    );
  }
  const err = await mutationPreflight(opts, opts);
  if (err) return err;

  let processed: Record<string, unknown>;
  if (opts.skipFieldPipeline) {
    processed = { ...data };
  } else {
    const sv = await standardizeAndValidate(opts.fields ?? [], data, true);
    if (sv.ok === false) return { success: false, errors: sv.errors };
    processed = sv.data;
  }

  let cascadeProcessed: CascadeUpdateChild[] | undefined;
  if (opts.cascadeData?.length) {
    if (!opts.cascade?.length) {
      return failV("cascadeData", "common.error.cascadeMissing");
    }
    const cv = await validateCascadeUpdateData(
      opts.cascade,
      opts.cascadeData,
      "cascadeData",
    );
    if (cv.ok === false) return { success: false, errors: cv.errors };
    cascadeProcessed = cv.data;
  }

  const bindings: Record<string, unknown> = { id: rid(id) };
  const rootUpdated = explicitFields(processed);
  const hasRoot = rootUpdated.length > 0;
  const hasCasc = !!cascadeProcessed?.length;
  const hasCascConf = !!opts.cascade?.length;
  const gateFields = uniqueFields(
    (opts.cascadeGateFields ?? []).filter((f) => f !== "id"),
  );

  if (!hasRoot && hasCasc && !gateFields.length) {
    return failV(
      "cascadeGateFields",
      "common.error.requiredForCascadeOnlyUpdate",
    );
  }
  if (
    !hasRoot && !hasCasc && hasCascConf &&
    (!opts.cascadeTouch || !gateFields.length)
  ) {
    return failV(
      "cascadeTouch",
      "common.error.cascadeTouchRequiresExplicitGateFields",
    );
  }

  const rootGateFields = hasRoot ? rootUpdated : gateFields;
  const setClauses = hasRoot
    ? await buildSetClauses(opts.table, processed, bindings, {
      isCreate: false,
    })
    : [];
  const idWhere = await buildIdAccessWhere(
    opts.table,
    "id",
    opts.tenant,
    "w",
    "",
    "any",
    rootGateFields,
    opts.skipAccessCheck === true,
  );
  Object.assign(bindings, idWhere.bindings);

  const adminGuards: string[] = [];
  if (opts.table === "tenant" && touchesAdminTenantFields(rootUpdated)) {
    adminGuards.push(
      ...buildTenantIdsAdminGuardSQL("[$id]", "_upd_root_tenant_admin"),
    );
  }
  if (opts.table === "role" && touchesAdminRoleFields(rootUpdated)) {
    adminGuards.push(
      ...buildRoleIdsAdminGuardSQL("[$id]", "_upd_root_role_admin"),
    );
  }

  const cascadePreflight: string[] = [];
  const cascadeMutation: string[] = [];
  if (opts.cascade?.length) {
    if (cascadeProcessed?.length) {
      const cu = await buildCascadeUpdateSQL(
        opts.cascade,
        cascadeProcessed,
        opts.table,
        "$id",
        opts.tenant,
        "upd",
        opts.cascadeTouch === true,
      );
      cascadePreflight.push(...cu.preflightLets);
      cascadeMutation.push(...cu.mutationLets);
      Object.assign(bindings, cu.bindings);
    } else if (opts.cascadeTouch === true) {
      const rawExp = await expandCascade(
        opts.table,
        "$id",
        opts.cascade,
        undefined,
        "w",
        "upd_raw",
        "raw",
      );
      const exp = await expandCascade(
        opts.table,
        "$id",
        opts.cascade,
        opts.tenant,
        "w",
        "upd",
        "any",
      );
      cascadePreflight.push(...rawExp.lets, ...exp.lets);
      Object.assign(bindings, rawExp.bindings, exp.bindings);
      const touchIdx = await nodeIndexSet(
        exp.nodes,
        (n) => tableHasField(n.table, "updatedAt"),
      );
      cascadePreflight.push(
        ...buildCoverageGuard(
          rawExp.nodes,
          exp.nodes,
          "common.error.cascadeUnauthorized",
          (_r, _a, i) => touchIdx.has(i),
        ),
      );
      for (const n of exp.nodes) {
        if (await tableHasField(n.table, "updatedAt")) {
          cascadeMutation.push(
            `UPDATE ${n.table} SET updatedAt = time::now() WHERE id IN $${n.idsVar};`,
          );
        }
      }
    }
  }

  const rootMutation = hasRoot
    ? [
      `LET $__updatedIds = (UPDATE ${opts.table} SET ${
        setClauses.join(", ")
      } WHERE id = $__rootAllowed RETURN AFTER.id);`,
      `IF array::len($__updatedIds) = 0 THEN RETURN { success: false, errorKey: "common.error.notFound" }; END;`,
    ]
    : [];

  if (!hasRoot && !cascadeMutation.length) {
    return failV("root", "common.error.noFieldsToUpdate");
  }

  const query = [
    `LET $__rootAllowed = (SELECT VALUE id FROM ${opts.table} WHERE ${
      idWhere.where.join(" AND ")
    } LIMIT 1)[0];`,
    `IF $__rootAllowed = NONE THEN RETURN { success: false, errorKey: "common.error.notFound" }; END;`,
    ...adminGuards,
    ...cascadePreflight,
    ...rootMutation,
    ...cascadeMutation,
    hasRoot
      ? `RETURN (FOR $u IN $__updatedIds { RETURN { id: $u }; });`
      : `RETURN [{ id: $__rootAllowed }];`,
  ].join("\n");

  const db = await getDb();
  const res = await db.query<unknown[]>(query, bindings);
  const early = findEarlyError<{ errorKey: string }>(res);
  if (early?.errorKey) {
    return {
      success: false,
      errors: valErr(
        early.errorKey === "common.error.notFound" ? "id" : "root",
        early.errorKey,
      ),
    };
  }
  const final = res[res.length - 1];
  const raw = Array.isArray(final)
    ? (final as T[])[0]
    : (final as T | undefined);
  const updated = raw ? setsToArrays(raw) : undefined;
  if (!updated) return failV("id", "common.error.notFound");
  return { success: true, data: updated };
}

// ----------------------------------------------------------------------------
// ASSOCIATE
// ----------------------------------------------------------------------------

export async function genericAssociate(
  opts: GenericCrudOptions,
  id: string,
  tenantToAdd: Tenant,
  caller?: Tenant,
): Promise<GenericResult<Record<string, unknown>>> {
  assertSafeCrud(opts, "genericAssociate");
  const e = await getCascadeTableError(
    opts.cascade,
    "mutation",
    opts as PrivOpt,
  );
  if (e) return failV("cascade", e);
  if (!(await tableHasField(opts.table, "tenantIds"))) {
    return failV("tenantIds", "common.error.notSupported");
  }

  const who = caller ?? tenantToAdd;
  if (!hasTenantSelector(tenantToAdd)) {
    return { success: false, errors: tenantSelectorErr("tenantToAdd") };
  }
  if (!tenantToAdd.id) {
    return failV("tenantToAdd", "common.error.existingTenantIdRequired");
  }
  if (!hasTenantSelector(who)) {
    return { success: false, errors: tenantSelectorErr("caller") };
  }

  const bindings: Record<string, unknown> = { id: rid(id) };
  const tr = resolveTenantLET(tenantToAdd, "__at", "resolveOrCreate");
  Object.assign(bindings, tr.bindings);

  const rootAccess = await buildIdAccessWhere(
    opts.table,
    "id",
    who,
    "w",
    "_root",
    "tenant",
  );
  Object.assign(bindings, rootAccess.bindings);

  const mutation = await buildCascadeTenantMutation(
    opts.table,
    "__rootIds",
    opts.cascade,
    who,
    "add",
    "{$__at,}",
    "assoc",
  );
  Object.assign(bindings, mutation.bindings);

  const query = [
    `LET $__rootCheck = (SELECT VALUE id FROM ${opts.table} WHERE ${
      rootAccess.where.join(" AND ")
    } LIMIT 1)[0];`,
    `IF $__rootCheck = NONE THEN RETURN { success: false, errorKey: "common.error.notFound" } END;`,
    ...tr.lets,
    tenantResolvedGuard("__at", "tenantToAdd"),
    `LET $__rootIds = [$id];`,
    ...mutation.lets,
    `RETURN { id: $id };`,
  ].join("\n");

  const db = await getDb();
  const res = await db.query<unknown[]>(query, bindings);
  const final = res[res.length - 1];
  if (isGenericFailure(final)) {
    return {
      success: false,
      errors: valErr(
        "root",
        (final as { errorKey?: string }).errorKey ?? "common.error.generic",
      ),
    };
  }
  const updated = setsToArrays(final as Record<string, unknown> | undefined);
  if (!updated) return failV("id", "common.error.notFound");
  return { success: true, data: updated };
}

// ----------------------------------------------------------------------------
// DISASSOCIATE
// ----------------------------------------------------------------------------

export async function genericDisassociate(
  opts: GenericCrudOptions,
  id: string,
  tenantToRemove: Tenant,
  caller?: Tenant,
): Promise<GenericResult<Record<string, unknown>>> {
  assertSafeCrud(opts, "genericDisassociate");
  const e = await getCascadeTableError(
    opts.cascade,
    "mutation",
    opts as PrivOpt,
  );
  if (e) return failV("cascade", e);
  if (!(await tableHasField(opts.table, "tenantIds"))) {
    return failV("tenantIds", "common.error.notSupported");
  }

  const who = caller ?? tenantToRemove;
  if (!hasTenantSelector(tenantToRemove)) {
    return { success: false, errors: tenantSelectorErr("tenantToRemove") };
  }
  if (!hasTenantSelector(who)) {
    return { success: false, errors: tenantSelectorErr("caller") };
  }

  const bindings: Record<string, unknown> = { id: rid(id) };
  const matching = buildCallerTenantsSQL(tenantToRemove, "_rm");
  Object.assign(bindings, matching.bindings);

  const rootAccess = await buildIdAccessWhere(
    opts.table,
    "id",
    who,
    "w",
    "_root",
    "tenant",
  );
  Object.assign(bindings, rootAccess.bindings);

  const mutation = await buildCascadeTenantMutation(
    opts.table,
    "__rootIds",
    opts.cascade,
    who,
    "remove",
    matching.sql,
    "disassoc",
  );
  Object.assign(bindings, mutation.bindings);

  const recordIdsExpr = mutation.tenantScopedNodes.length
    ? `array::union([$id], ${
      mutation.tenantScopedNodes.map((n) => `$${n.idsVar}`).join(", ")
    })`
    : "[$id]";

  // Extract last-tenant-removal guards and add flat checks
  const disassocGuardSlots = mutation.lets
    .filter((l) => l.includes("_lastTenantRemoval"))
    .map((l) => {
      const m = l.match(/LET (\$_ct_.*?_lastTenantRemoval)/);
      return m?.[1];
    })
    .filter(Boolean) as string[];

  const query = [
    `LET $__rootCheck = (SELECT VALUE id FROM ${opts.table} WHERE ${
      rootAccess.where.join(" AND ")
    } LIMIT 1)[0];`,
    `IF $__rootCheck = NONE THEN RETURN { success: false, errorKey: "common.error.notFound" } END;`,
    `LET $__rootHadTenant = (SELECT VALUE id FROM ${opts.table} WHERE id = $id AND tenantIds CONTAINSANY ${matching.sql} LIMIT 1)[0];`,
    `IF $__rootHadTenant = NONE THEN RETURN { success: false, errorKey: "common.error.notAssociated" } END;`,
    `LET $__rootIds = [$id];`,
    ...mutation.lets,
    ...disassocGuardSlots.map(
      (slot) =>
        `IF ${slot} > 0 THEN RETURN { success: false, errorKey: "common.error.lastTenantRemoval" }; END;`,
    ),
    sharedRecordTenantCleanupSQL(recordIdsExpr, matching.sql),
    `RETURN { id: $id };`,
  ].join("\n");

  const db = await getDb();
  const res = await db.query<unknown[]>(query, bindings);
  const final = res[res.length - 1] as
    | (Record<string, unknown> & { success?: boolean; errorKey?: string })
    | undefined;
  if (isGenericFailure(final)) {
    return {
      success: false,
      errors: valErr(
        "root",
        (final as { errorKey?: string }).errorKey ?? "common.error.generic",
      ),
    };
  }
  if (final?.errorKey) {
    return { success: false, errors: valErr("root", final.errorKey) };
  }
  if (!final) return failV("id", "common.error.notFound");
  return { success: true, data: setsToArrays(final) };
}

// ----------------------------------------------------------------------------
// DELETE
// ----------------------------------------------------------------------------

export async function genericDelete(
  opts: GenericCrudOptions & PrivOpt,
  id: string,
): Promise<GenericDeleteResult> {
  assertSafeCrud(opts, "genericDelete");
  assertSafeDeleteCascade(opts.cascade, "genericDelete.cascade");
  const e1 = await getTableError(opts.table, "mutation", opts as PrivOpt);
  if (e1) {
    return { success: false, deleted: false, orphaned: false, errorKey: e1 };
  }
  const e2 = await getCascadeTableError(
    opts.cascade,
    "mutation",
    opts as PrivOpt,
  );
  if (e2) {
    return { success: false, deleted: false, orphaned: false, errorKey: e2 };
  }

  const hasT = await tableHasField(opts.table, "tenantIds");
  if (hasT && !hasTenantSelector(opts.tenant) && !opts.skipAccessCheck) {
    return {
      success: false,
      deleted: false,
      orphaned: false,
      errorKey: "common.error.tenantSelectorRequired",
    };
  }

  const bindings: Record<string, unknown> = { id: rid(id) };
  const idWhere = await buildIdAccessWhere(
    opts.table,
    "id",
    opts.tenant,
    "w",
    "_del_root",
    "any",
    [],
  );
  Object.assign(bindings, idWhere.bindings);
  const matching = buildCallerTenantsSQL(opts.tenant, "_del");
  Object.assign(bindings, matching.bindings);

  let orphan: {
    lets: string[];
    collectorLets: string[];
    guardLets: string[];
    updateLets: string[];
    bindings: Record<string, unknown>;
    cascadedTables: string[];
    tenantScopedNodes: CascadeNodeInfo[];
  } | null = null;
  if (hasT && opts.tenant) {
    orphan = await buildCascadeTenantMutation(
      opts.table,
      "__rootIds",
      opts.cascade,
      opts.tenant,
      "remove",
      matching.sql,
      "del_orphan",
    );
    Object.assign(bindings, orphan.bindings);
  }

  const lets: string[] = [
    `LET $__before = (SELECT * FROM ${opts.table} WHERE ${
      idWhere.where.join(" AND ")
    } LIMIT 1)[0];`,
    `IF $__before = NONE THEN RETURN { deleted: false, orphaned: false }; END;`,
  ];

  if (hasT && opts.tenant) {
    lets.push(
      `LET $__callerOwnsRoot = $__before.tenantIds CONTAINSANY ${matching.sql};`,
      `LET $__remaining = set::difference($__before.tenantIds, ${matching.sql});`,
    );

    lets.push(
      `LET $__rootIds = [$id];`,
    );

    if (orphan) {
      // Collector LETs — run unconditionally.
      // They only compute cascade IDs; mutation/return is still guarded below.
      for (const cl of orphan.collectorLets) {
        lets.push(cl);
      }

      // Guard LETs — compute last-tenant-removal counts.
      for (const gl of orphan.guardLets) {
        lets.push(gl);
      }

      // Flat guard checks.
      const guardSlots: string[] = orphan.guardLets
        .map((l: string) => {
          const m = l.match(/LET (\$_ct_.*?_lastTenantRemoval)/);
          return m?.[1];
        })
        .filter((v: string | undefined): v is string => v !== undefined);

      for (const slot of guardSlots) {
        lets.push(
          `IF ${slot} > 0 AND $__callerOwnsRoot AND set::len($__remaining) > 0 THEN RETURN { success: false, errorKey: "common.error.lastTenantRemoval" }; END;`,
        );
      }

      // SurrealDB 3.0 only allows ONE statement per IF/THEN/END.
      // Wrap each update LET in its own IF guard.
      for (const ul of orphan.updateLets) {
        lets.push(
          `IF $__callerOwnsRoot AND set::len($__remaining) > 0 THEN ${ul} END;`,
        );
      }

      // Shared-record cleanup — only when this is a real direct-tenant dissociation.
      const srCleanup = sharedRecordTenantCleanupSQL(
        orphan.tenantScopedNodes.length
          ? `array::union([$id], ${
            orphan.tenantScopedNodes.map((n) => `$${n.idsVar}`).join(", ")
          })`
          : "[$id]",
        matching.sql,
      );

      for (
        const stmt of srCleanup.split(";").map((s: string) => s.trim()).filter((
          s: string,
        ) => s)
      ) {
        lets.push(
          `IF $__callerOwnsRoot AND set::len($__remaining) > 0 THEN ${stmt}; END;`,
        );
      }

      // Early return for direct tenant dissociation path.
      lets.push(
        `IF $__callerOwnsRoot AND set::len($__remaining) > 0 THEN RETURN { deleted: false, orphaned: true, cascaded: ${
          JSON.stringify(orphan.cascadedTables)
        } }; END;`,
      );
    } else {
      // No cascade — just dissociate root, but only for direct owner tenants.
      lets.push(
        `IF $__callerOwnsRoot AND set::len($__remaining) > 0 THEN UPDATE ${opts.table} SET tenantIds = set::difference(tenantIds, ${matching.sql}) WHERE id = $id; END;`,
      );

      const srCleanup2 = sharedRecordTenantCleanupSQL("[$id]", matching.sql);

      for (
        const stmt of srCleanup2.split(";").map((s: string) => s.trim()).filter(
          (s: string) => s,
        )
      ) {
        lets.push(
          `IF $__callerOwnsRoot AND set::len($__remaining) > 0 THEN ${stmt}; END;`,
        );
      }

      lets.push(
        `IF $__callerOwnsRoot AND set::len($__remaining) > 0 THEN RETURN { deleted: false, orphaned: true, cascaded: [] }; END;`,
      );
    }
  }

  const cascadedTables: string[] = [];
  let deletedIdsExpr = "[$id]";

  if (opts.cascade?.length) {
    const rawExp = await expandCascade(
      opts.table,
      "$id",
      opts.cascade,
      undefined,
      "w",
      "del_restrict",
      "raw",
    );
    lets.push(...rawExp.lets);

    const detachOnlyRaw = new Set(
      rawExp.nodes.filter((n) => getDeleteAction(n) === "detach").map((n) =>
        n.idsVar
      ),
    );
    const rawByVar = new Map(rawExp.nodes.map((n) => [n.idsVar, n]));
    const underDetachedRaw = (n: CascadeNodeInfo): boolean => {
      let p = rawByVar.get(n.parentIdsVar);
      while (p) {
        if (detachOnlyRaw.has(p.idsVar)) return true;
        p = rawByVar.get(p.parentIdsVar);
      }
      return false;
    };

    for (const n of rawExp.nodes) {
      if (underDetachedRaw(n)) continue;
      if (getDeleteAction(n) === "restrict") {
        lets.push(
          `IF array::len($${n.idsVar}) > 0 THEN
             RETURN { deleted: false, orphaned: false, errorKey: "common.error.cascadeRestrict" };
           END;`,
        );
      }
    }
    const deleteAccessFields = buildFullRecordCascadeAccessFields(opts.cascade);
    const exp = await expandCascade(
      opts.table,
      "$id",
      opts.cascade,
      opts.tenant,
      "w",
      "del",
      "any",
      deleteAccessFields,
    );
    lets.push(...exp.lets);
    Object.assign(bindings, exp.bindings);

    for (let i = 0; i < rawExp.nodes.length; i++) {
      const r = rawExp.nodes[i], a = exp.nodes[i];
      if (!a || underDetachedRaw(r)) continue;
      const act = getDeleteAction(r);
      if (act === "delete" || act === "detach") {
        lets.push(
          `IF array::len(array::difference($${r.idsVar}, $${a.idsVar})) > 0 THEN
             RETURN { deleted: false, orphaned: false, errorKey: "common.error.cascadeUnauthorized" };
           END;`,
        );
      }
    }

    const detachOnly = new Set(
      exp.nodes.filter((n) => getDeleteAction(n) === "detach").map((n) =>
        n.idsVar
      ),
    );
    const byVar = new Map(exp.nodes.map((n) => [n.idsVar, n]));
    const underDetached = (n: CascadeNodeInfo): boolean => {
      let p = byVar.get(n.parentIdsVar);
      while (p) {
        if (detachOnly.has(p.idsVar)) return true;
        p = byVar.get(p.parentIdsVar);
      }
      return false;
    };

    for (const n of exp.nodes) {
      if (underDetached(n)) continue;
      if (getDeleteAction(n) === "restrict") {
        lets.push(
          `IF array::len($${n.idsVar}) > 0 THEN
             RETURN { deleted: false, orphaned: false, errorKey: "common.error.cascadeRestrict" };
           END;`,
        );
      }
    }

    const isDeleted = (n: CascadeNodeInfo) =>
      !underDetached(n) && getDeleteAction(n) === "delete";
    const deleteVars = exp.nodes.filter(isDeleted).map((n) => `$${n.idsVar}`);
    if (deleteVars.length) {
      deletedIdsExpr = `array::union([$id], ${deleteVars.join(", ")})`;
    }

    const aggregate = (table: string) => {
      const v = exp.nodes.filter((n) => n.table === table && isDeleted(n)).map(
        (n) => `$${n.idsVar}`,
      );
      if (opts.table === table) v.unshift("[$id]");
      return v;
    };
    const userVars = aggregate("user");
    if (userVars.length) {
      const expr = userVars.length === 1
        ? userVars[0]
        : `array::union(${userVars.join(", ")})`;
      lets.push(...buildAdminInvariantForUserIdsSQL(expr, "_del_users"));
    }
    const tenantVars = aggregate("tenant");
    if (tenantVars.length) {
      const expr = tenantVars.length === 1
        ? tenantVars[0]
        : `array::union(${tenantVars.join(", ")})`;
      lets.push(...buildTenantIdsAdminGuardSQL(expr, "_del_tenants"));
    }
    const roleVars = aggregate("role");
    if (roleVars.length) {
      const expr = roleVars.length === 1
        ? roleVars[0]
        : `array::union(${roleVars.join(", ")})`;
      lets.push(...buildRoleIdsAdminGuardSQL(expr, "_del_roles"));
    }

    for (const n of [...exp.nodes].reverse()) {
      if (underDetached(n)) continue;
      const act = getDeleteAction(n);
      if (act === "restrict") continue;
      cascadedTables.push(n.table);
      if (act === "detach") {
        if (n.sourceField) {
          const se = n.isArray
            ? `${n.sourceField} = set::difference(${n.sourceField}, <set>$${n.idsVar})`
            : `${n.sourceField} = NONE`;
          lets.push(
            `UPDATE ${n.parentTable} SET ${se} WHERE id IN $${n.parentIdsVar};`,
          );
        } else if (n.parentField) {
          const se = n.isArray
            ? `${n.parentField} = set::difference(${n.parentField}, <set>$${n.parentIdsVar})`
            : `${n.parentField} = NONE`;
          lets.push(`UPDATE ${n.table} SET ${se} WHERE id IN $${n.idsVar};`);
        }
        continue;
      }
      lets.push(`DELETE FROM ${n.table} WHERE id IN $${n.idsVar};`);
    }
  } else {
    if (opts.table === "user") lets.push(...buildAdminInvariantSQL());
    if (opts.table === "tenant") {
      lets.push(...buildTenantIdsAdminGuardSQL("[$id]", "_del_root_tenant"));
    }
    if (opts.table === "role") {
      lets.push(...buildRoleIdsAdminGuardSQL("[$id]", "_del_root_role"));
    }
  }

  lets.push(
    `DELETE FROM ${opts.table} WHERE id = $id;`,
    sharedRecordCleanupSQL(deletedIdsExpr),
    `RETURN { deleted: true, orphaned: false, cascaded: ${
      JSON.stringify(cascadedTables)
    } };`,
  );

  const db = await getDb();
  const res = await db.query(lets.join("\n"), bindings);
  const ret = res[res.length - 1] as GenericDeleteResult | undefined;
  return {
    success: !(ret?.errorKey),
    deleted: ret?.deleted ?? false,
    orphaned: ret?.orphaned ?? false,
    cascaded: ret?.cascaded,
    errorKey: ret?.errorKey,
  };
}

// ----------------------------------------------------------------------------
// COUNT
// ----------------------------------------------------------------------------

export async function genericCount(
  opts: GenericListOptions & PrivOpt & RawCondOpt & ExtraAccOpt,
): Promise<number | { total: number; byTable: Record<string, number> }> {
  assertSafeListish(opts as ListOptsLike, "genericCount", false);
  const zero = opts.cascade?.length ? { total: 0, byTable: {} } : 0;
  if (await getTableError(opts.table, "read", opts)) return zero;
  if (await getCascadeTableError(opts.cascade, "read", opts)) return zero;

  const accessFields = await buildListAccessFields(
    opts as ListOptsLike,
    undefined,
    false,
  );
  const { conds, bindings } = await buildListFilters(
    opts as ListOptsLike,
    accessFields,
    opts.skipAccessCheck === true,
  );
  const where = conds.length ? ` WHERE ${conds.join(" AND ")}` : "";

  if (!opts.cascade?.length) {
    const q = `SELECT count() AS total FROM ${opts.table}${where} GROUP ALL;`;
    const db = await getDb();
    const r = await db.query<[{ total: number }[]]>(q, bindings);
    return r[0]?.[0]?.total ?? 0;
  }

  const lets: string[] = [
    `LET $__rootIds = (SELECT VALUE id FROM ${opts.table}${where});`,
  ];
  const fieldsByTable = await buildCascadeCountAccessFields(
    opts.cascade,
    opts.tenant,
    "cnt",
  );
  const col = await collectCascadeIds(
    opts.cascade,
    opts.table,
    "__rootIds",
    opts.tenant,
    "r",
    "cnt",
    "any",
    fieldsByTable,
  );
  lets.push(...col.lets);
  Object.assign(bindings, col.bindings);

  const entries = col.nodes.map((n) =>
    `"${n.table}_${n.idsVar}": array::len($${n.idsVar})`
  );
  lets.push(
    `RETURN { total: array::len($__rootIds), nodes: { ${
      entries.join(", ")
    } } };`,
  );

  const db = await getDb();
  const res = await db.query<unknown[]>(lets.join("\n"), bindings);
  const ret = res[res.length - 1] as {
    total: number;
    nodes: Record<string, number>;
  } | undefined;
  if (!ret) return { total: 0, byTable: {} };

  const byTable: Record<string, number> = {};
  for (const n of col.nodes) {
    byTable[n.table] = (byTable[n.table] ?? 0) +
      (ret.nodes[`${n.table}_${n.idsVar}`] ?? 0);
  }
  return { total: ret.total, byTable };
}

// ----------------------------------------------------------------------------
// DECRYPT
// ----------------------------------------------------------------------------

export async function genericDecrypt(
  opts: GenericCrudOptions & { decryptFields: DecryptFieldSpec[] },
  id: string,
): Promise<Record<string, string | undefined>> {
  assertSafeCrud(opts, "genericDecrypt");
  if (await getTableError(opts.table, "read", opts as PrivOpt)) return {};
  if (!opts.decryptFields.length) return {};
  const readFields = opts.decryptFields.map((f) => f.field);
  assertSafeFieldPaths(readFields, "genericDecrypt.decryptFields");

  const bindings: Record<string, unknown> = { id: rid(id) };
  const idWhere = await buildIdAccessWhere(
    opts.table,
    "id",
    opts.tenant,
    "r",
    "_dec",
    "any",
    readFields,
    opts.skipAccessCheck === true,
  );
  Object.assign(bindings, idWhere.bindings);

  const query = `SELECT ${readFields.join(", ")} FROM ${opts.table} WHERE ${
    idWhere.where.join(" AND ")
  } LIMIT 1;`;
  const db = await getDb();
  const res = await db.query<[Record<string, string>[]]>(query, bindings);
  const row = res[0]?.[0];
  if (!row) return {};

  const out: Record<string, string | undefined> = {};
  for (const spec of opts.decryptFields) {
    const raw = getPath(row, spec.field) as string | null | undefined;
    out[spec.field] = spec.optional
      ? await decryptFieldOptional(raw)
      : raw
      ? await decryptField(raw)
      : undefined;
  }
  return out;
}

// ----------------------------------------------------------------------------
// VERIFY
// ----------------------------------------------------------------------------

export async function genericVerify(
  opts: GenericCrudOptions & { hashField: string },
  id: string,
  plaintext: string,
): Promise<boolean> {
  assertSafeCrud(opts, "genericVerify");
  if (await getTableError(opts.table, "read", opts as PrivOpt)) return false;
  if (!isSafeIdent(opts.hashField)) return false;

  const bindings: Record<string, unknown> = { id: rid(id), __plain: plaintext };
  const idWhere = await buildIdAccessWhere(
    opts.table,
    "id",
    opts.tenant,
    "r",
    "_ver",
    "any",
    [opts.hashField],
    opts.skipAccessCheck === true,
  );
  Object.assign(bindings, idWhere.bindings);

  const query = [
    `LET $__row = (SELECT ${opts.hashField} FROM ${opts.table} WHERE ${
      idWhere.where.join(" AND ")
    } LIMIT 1)[0];`,
    `LET $__hash = IF $__row = NONE THEN NONE ELSE $__row.${opts.hashField} END;`,
    `RETURN IF $__hash = NONE THEN false ELSE crypto::argon2::compare($__hash, $__plain) END;`,
  ].join("\n");
  const db = await getDb();
  const res = await db.query<[boolean]>(query, bindings);
  return res[res.length - 1] === true;
}

// ----------------------------------------------------------------------------
// LIST SHARED RECORDS
// ----------------------------------------------------------------------------

export async function genericListSharedRecords(
  opts: ListSharedRecordsOptions,
): Promise<PaginatedResult<SharedRecordContract>> {
  const ext = opts as ListSharedRecordsOptions & {
    table?: string;
    cascade?: CascadeChild[];
    accessFields?: string[];
  };
  if (ext.table) assertSafe("ident", ext.table, `table:${ext.table}`);
  if (ext.accessFields) {
    assertSafeFieldPaths(
      ext.accessFields,
      "genericListSharedRecords.accessFields",
    );
  }
  assertSafeCascade(ext.cascade, "genericListSharedRecords.cascade");
  if (
    await getCascadeTableError(ext.cascade, "read", opts as unknown as PrivOpt)
  ) {
    return { items: [], total: 0, hasMore: false, nextCursor: undefined };
  }
  if (!hasTenantSelector(opts.tenant)) {
    return { items: [], total: 0, hasMore: false, nextCursor: undefined };
  }

  const baseConds: string[] = [];
  const bindings: Record<string, unknown> = {};
  const prelude: string[] = [];

  if (opts.recordId) {
    if (!ext.table) {
      return { items: [], total: 0, hasMore: false, nextCursor: undefined };
    }
    bindings.recordId = rid(opts.recordId);
    const rootHasT = await tableHasField(ext.table, "tenantIds");
    const rootAccessFields = rootHasT
      ? uniqueFields((ext.accessFields ?? []).filter((f) => f !== "id"))
      : undefined;
    const rootMode: AccessMode =
      rootHasT && (!rootAccessFields || !rootAccessFields.length)
        ? "tenant"
        : "any";

    const rootAccess = await buildIdAccessWhere(
      ext.table,
      "recordId",
      opts.tenant,
      "r",
      "_lsr_root",
      rootMode,
      rootAccessFields,
    );
    Object.assign(bindings, rootAccess.bindings);
    prelude.push(
      `LET $__lsrRootAllowed = (SELECT VALUE id FROM ${ext.table} WHERE ${
        rootAccess.where.join(" AND ")
      } LIMIT 1)[0];`,
      `LET $__lsrRootIds = IF $__lsrRootAllowed = NONE THEN [] ELSE [$recordId] END;`,
    );

    if (ext.cascade?.length) {
      // Cascade access scope: per-node accessFields ∪ listOptions-touched
      // fields. Note collectCascadeIds already merges listOptions fields
      // into its own access scope; we still seed the preset so that
      // explicitly-configured accessFields are honored.
      const fieldsByTable = new Map<string, string[]>();
      let slot = 0;
      const collect = (cs: CascadeChild[]) => {
        for (const c of cs) {
          const key = `lsr_${slot++}`;
          const extC = c as KChild;
          const cf = uniqueFields(
            (extC.accessFields ?? rootAccessFields ?? []).filter((f) =>
              f !== "id"
            ),
          );
          if (rootMode === "any" && cf.length) fieldsByTable.set(key, cf);
          if (c.children?.length) collect(c.children);
        }
      };
      collect(ext.cascade);

      const col = await collectCascadeIds(
        ext.cascade,
        ext.table,
        "__lsrRootIds",
        opts.tenant,
        "r",
        "lsr",
        rootMode,
        fieldsByTable.size ? fieldsByTable : undefined,
      );
      prelude.push(...col.lets);
      Object.assign(bindings, col.bindings);
      baseConds.push(
        `recordId IN ${unionCascadeIdsSQL("__lsrRootIds", col.nodes)}`,
      );
    } else {
      baseConds.push("recordId IN $__lsrRootIds");
    }
  }

  const matching = buildCallerTenantsSQL(opts.tenant, "_sr");
  Object.assign(bindings, matching.bindings);
  baseConds.push(
    `ownerTenantIds CONTAINSANY (recordId.tenantIds ?? [])`,
    `(ownerTenantIds CONTAINSANY ${matching.sql} OR accessesTenantIds CONTAINSANY ${matching.sql})`,
  );

  const limit = Math.max(1, opts.limit ?? 50);
  bindings.__limit = limit + 1;
  const itemConds = [...baseConds];
  if (opts.cursor) {
    itemConds.push("id > $__cursor");
    bindings.__cursor = rid(opts.cursor);
  }

  const baseWhere = baseConds.length ? ` WHERE ${baseConds.join(" AND ")}` : "";
  const itemWhere = itemConds.length ? ` WHERE ${itemConds.join(" AND ")}` : "";
  const query = [
    ...prelude,
    `LET $__rows = (SELECT * FROM shared_record${itemWhere} ORDER BY id ASC LIMIT $__limit);`,
    `LET $__totalRow = (SELECT count() AS c FROM shared_record${baseWhere} GROUP ALL);`,
    `LET $__total = IF array::len($__totalRow) > 0 THEN $__totalRow[0].c ELSE 0 END;`,
    `RETURN { rows: $__rows, total: $__total };`,
  ].join("\n");

  const db = await getDb();
  const res = await db.query<unknown[]>(query, bindings);
  const final = (res[res.length - 1] ?? {}) as {
    rows?: SharedRecordContract[];
    total?: number;
  };
  const rows = (final.rows ?? []).map((r) => setsToArrays(r));
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return {
    items,
    total: final.total ?? 0,
    hasMore,
    nextCursor: hasMore && items.length
      ? stringifyId(items[items.length - 1].id)
      : undefined,
  };
}

// ----------------------------------------------------------------------------
// CREATE SHARED RECORD (wrapper over addShare)
// ----------------------------------------------------------------------------

export async function genericCreateSharedRecord(
  data: {
    recordId: string;
    accessTenant: Tenant;
    permissions: string[];
    fields?: string[];
    table?: string;
    cascade?: CascadeChild[];
  },
  caller: Tenant,
): Promise<GenericResult<SharedRecordContract>> {
  if (!data.table) return failV("table", "common.error.required");
  assertSafe("ident", data.table, `table:${data.table}`);
  assertSafeCascade(data.cascade, "genericCreateSharedRecord.cascade");
  const e = await getCascadeTableError(data.cascade, "mutation");
  if (e) return failV("cascade", e);
  return addShare(
    { table: data.table, cascade: data.cascade },
    data.recordId,
    data.accessTenant,
    data.permissions,
    caller,
    data.fields,
  );
}

// ----------------------------------------------------------------------------
// DELETE SHARED RECORDS
// ----------------------------------------------------------------------------

export async function genericDeleteSharedRecords(
  ids: string[],
  caller: Tenant,
  cascadeOpts?: { table: string; cascade: CascadeChild[] },
): Promise<{ success: boolean; deletedCount: number }> {
  if (!cascadeOpts?.table) return { success: false, deletedCount: 0 };
  assertSafe("ident", cascadeOpts.table, `table:${cascadeOpts.table}`);
  assertSafeCascade(cascadeOpts.cascade, "genericDeleteSharedRecords.cascade");
  if (await getCascadeTableError(cascadeOpts.cascade, "read")) {
    return { success: false, deletedCount: 0 };
  }
  if (!ids.length) return { success: true, deletedCount: 0 };
  if (!hasTenantSelector(caller)) return { success: false, deletedCount: 0 };

  const bindings: Record<string, unknown> = { __ids: ids.map((i) => rid(i)) };
  const matching = buildCallerTenantsSQL(caller, "_dsr");
  Object.assign(bindings, matching.bindings);
  const cm = matching.sql;

  const lets: string[] = [
    `LET $__rootsAll = (SELECT * FROM shared_record WHERE id IN $__ids);`,
    `LET $__roots = (FOR $sr IN $__rootsAll {
        LET $__srTenantIds = (SELECT VALUE tenantIds FROM ${cascadeOpts.table}
            WHERE id = $sr.recordId LIMIT 1)[0] ?? [];
        LET $__srIsActualOwner = $__srTenantIds CONTAINSANY ${cm};
        LET $__srPerms = ${
      callerPermsForFieldsSQL(
        "$sr.recordId",
        cm,
        "$sr.fields",
        "$__srIsActualOwner",
        "$__srTenantIds",
      )
    };
        IF $__srIsActualOwner OR $__srPerms CONTAINS "share" { RETURN $sr; };
     });`,
    `LET $__rootIds = array::flatten($__roots.id);`,
    `LET $__rootRecordIds = array::flatten($__roots.recordId);`,
    `LET $__cascadeDeleted = [];`,
  ];

  if (cascadeOpts.cascade.length) {
    const rawCol = await collectCascadeIds(
      cascadeOpts.cascade,
      cascadeOpts.table,
      "__rootRecordIds",
      undefined,
      "share",
      "dsr_raw",
      "raw",
    );
    const col = await collectCascadeIds(
      cascadeOpts.cascade,
      cascadeOpts.table,
      "__rootRecordIds",
      caller,
      "share",
      "dsr",
      "any",
    );
    lets.push(...rawCol.lets, ...col.lets);
    Object.assign(bindings, rawCol.bindings, col.bindings);
    lets.push(
      ...await coverageGuardForKind(rawCol.nodes, col.nodes, "shareable"),
    );

    const deletedVars: string[] = [];
    const shareNodes = await filterNodes(col.nodes, "shareable");
    shareNodes.forEach((node, i) => {
      const cand = `__cascadeCandidates_${i}`;
      const del = `__cascadeDeleted_${i}`;
      deletedVars.push(del);
      lets.push(
        `LET $${cand} = (SELECT * FROM shared_record WHERE recordId IN $${node.idsVar} AND id NOT IN $__rootIds);`,
        `LET $${del} = (FOR $candidate IN $${cand} {
            LET $__matchesRootTuple = count(
              FOR $r IN $__roots {
                IF $candidate.propagationRootRecordId = $r.recordId
                   AND $candidate.propagationOwnerTenantIds = $r.ownerTenantIds
                   AND $candidate.propagationAccessTenantIds = $r.accessesTenantIds { RETURN true; };
              }
            ) > 0;
            LET $__candidateTenantIds = (SELECT VALUE tenantIds FROM ${node.table}
                WHERE id = $candidate.recordId LIMIT 1)[0] ?? [];
            LET $__candidateIsActualOwner = $__candidateTenantIds CONTAINSANY ${cm};
            LET $__candidatePerms = ${
          callerPermsForFieldsSQL(
            "$candidate.recordId",
            cm,
            "$candidate.fields",
            "$__candidateIsActualOwner",
            "$__candidateTenantIds",
          )
        };
            IF $__matchesRootTuple AND ($__candidateIsActualOwner OR $__candidatePerms CONTAINS "share") {
              RETURN (DELETE shared_record WHERE id = $candidate.id RETURN BEFORE)[0];
            };
          });`,
      );
    });
    if (deletedVars.length) {
      lets.push(
        `LET $__cascadeDeleted = array::flatten([${
          deletedVars.map((v) => `$${v}`).join(", ")
        }]);`,
      );
    }
  }

  lets.push(
    `LET $__deleted = (DELETE shared_record WHERE id IN $__rootIds RETURN BEFORE);`,
    `RETURN { root: $__deleted, cascade: $__cascadeDeleted };`,
  );

  const db = await getDb();
  const res = await db.query<unknown[]>(lets.join("\n"), bindings);
  const ret = (res[res.length - 1] ?? {}) as {
    success?: boolean;
    errorKey?: string;
    root?: SharedRecordContract[];
    cascade?: SharedRecordContract[];
  };
  if (ret.success === false || ret.errorKey) {
    return { success: false, deletedCount: 0 };
  }
  return {
    success: true,
    deletedCount: (ret.root?.length ?? 0) + (ret.cascade?.length ?? 0),
  };
}

// ----------------------------------------------------------------------------
// ADD SHARE
// ----------------------------------------------------------------------------

export async function addShare(
  opts: { table: string; cascade?: CascadeChild[] },
  recordId: string,
  target: Tenant,
  permissions: string[],
  caller: Tenant,
  fields?: string[],
): Promise<GenericResult<SharedRecordContract>> {
  assertSafe("ident", opts.table, `table:${opts.table}`);
  assertSafeCascade(opts.cascade, "addShare.cascade");
  const e = await getCascadeTableError(opts.cascade, "read");
  if (e) return failV("cascade", e);
  if (isSensitive(opts.table)) {
    return failV("table", "common.error.securityTableNotShareable");
  }
  if (!(await tableHasField(opts.table, "tenantIds"))) {
    return failV("table", "common.error.notSupported");
  }

  const checked = validatePermsStrict(permissions);
  if (!checked.ok) {
    return failV("permissions", "common.error.invalidPermissions");
  }
  if (fields) {
    try {
      assertSafeFieldPaths(fields, "addShare.fields");
    } catch {
      return failV("fields", "common.error.unsafeField");
    }
  }

  const fe = await validateShareFieldsForTree(
    opts.table,
    opts.cascade,
    fields ?? [],
    "fields",
  );
  if (fe) return { success: false, errors: fe };

  if (!hasTenantSelector(caller)) {
    return { success: false, errors: tenantSelectorErr("caller") };
  }
  if (!hasTenantSelector(target)) {
    return { success: false, errors: tenantSelectorErr("target") };
  }
  if (!target.id) {
    return failV("target", "common.error.existingTenantIdRequired");
  }

  const bindings: Record<string, unknown> = {
    __rid: rid(recordId),
    __perms: checked.permissions,
    __targetFields: fields ?? [],
  };
  const callerMatch = buildCallerTenantsSQL(caller, "_sh");
  Object.assign(bindings, callerMatch.bindings);
  const targetLet = resolveTenantLET(target, "__target", "existing");
  Object.assign(bindings, targetLet.bindings);
  const cm = callerMatch.sql;

  const cascadePreflight: string[] = [];
  const cascadePropagation: string[] = [];
  if (opts.cascade?.length) {
    cascadePreflight.push(`LET $__rootIdSet = [$__rid];`);
    const rawCol = await collectCascadeIds(
      opts.cascade,
      opts.table,
      "__rootIdSet",
      undefined,
      "share",
      "sh_raw",
      "raw",
    );
    const col = await collectCascadeIds(
      opts.cascade,
      opts.table,
      "__rootIdSet",
      caller,
      "share",
      "sh",
      "any",
    );
    cascadePreflight.push(...rawCol.lets, ...col.lets);
    Object.assign(bindings, rawCol.bindings, col.bindings);
    cascadePreflight.push(
      ...await coverageGuardForKind(rawCol.nodes, col.nodes, "shareable"),
    );
    const shareNodes = await filterNodes(col.nodes, "shareable");
    cascadePropagation.push(...buildCascadeSharePropagationSQL(
      shareNodes,
      cm,
      "$__shareOwnerTenant",
      "$__target",
      "$__allowedPerms",
      "$__targetFields",
      "$__rid",
    ));
  }

  const lets: string[] = [
    `LET $__recordTenantIds = <set>((SELECT VALUE tenantIds FROM ${opts.table} WHERE id = $__rid LIMIT 1)[0] ?? []);`,
    `IF set::len($__recordTenantIds) = 0 THEN RETURN { success: false, errors: [{ field: "id", errors: ["common.error.notFound"] }] } END;`,
    `LET $__directOwnerTenant = set::intersect($__recordTenantIds, ${cm})[0];`,
    `LET $__isOwner = $__directOwnerTenant != NONE;`,
    `LET $__shareAuth = IF $__isOwner THEN NONE ELSE (SELECT * FROM shared_record
        WHERE recordId = $__rid
          AND accessesTenantIds CONTAINSANY ${cm}
          AND ownerTenantIds CONTAINSANY $__recordTenantIds
          AND permissions CONTAINS "share"
          AND (IF set::len($__targetFields) = 0
               THEN set::len(fields) = 0
               ELSE set::len(fields) = 0 OR fields CONTAINSALL $__targetFields END)
        LIMIT 1)[0] END;`,
    `LET $__delegatedOwnerTenant = IF $__shareAuth = NONE THEN NONE ELSE set::intersect($__shareAuth.ownerTenantIds, $__recordTenantIds)[0] END;`,
    `LET $__caller = IF $__isOwner THEN $__directOwnerTenant ELSE IF $__shareAuth = NONE THEN NONE ELSE set::intersect($__shareAuth.accessesTenantIds, ${cm})[0] END END;`,
    `LET $__shareOwnerTenant = IF $__isOwner THEN $__directOwnerTenant ELSE $__delegatedOwnerTenant END;`,
    `IF $__caller = NONE OR $__shareOwnerTenant = NONE THEN
        RETURN { success: false, errors: [{ field: "caller", errors: ["common.error.forbidden"] }] } END;`,
    `LET $__callerPerms = ${
      callerPermsForFieldsSQL(
        "$__rid",
        cm,
        "$__targetFields",
        "$__isOwner",
        "$__recordTenantIds",
      )
    };`,
    `LET $__canShare = $__isOwner OR $__callerPerms CONTAINS "share";`,
    `LET $__allowedPerms = IF $__isOwner THEN $__perms ELSE set::intersect($__perms, $__callerPerms) END;`,
    `LET $__fieldsOk = ${
      callerCanShareFieldsSQL(
        "$__rid",
        cm,
        "$__targetFields",
        "$__isOwner",
        "$__recordTenantIds",
      )
    };`,
    `IF NOT $__canShare OR set::len($__allowedPerms) = 0 OR NOT $__fieldsOk THEN
        RETURN { success: false, errors: [{ field: "permissions", errors: ["common.error.forbidden"] }] } END;`,
    ...targetLet.lets,
    tenantResolvedGuard("__target", "target"),
    ...cascadePreflight,
    `LET $__created = (CREATE shared_record SET
        recordId = $__rid,
        ownerTenantIds = {$__shareOwnerTenant,},
        accessesTenantIds = {$__target,},
        permissions = $__allowedPerms,
        fields = $__targetFields)[0];`,
    ...cascadePropagation,
    `RETURN { success: true, data: $__created };`,
  ];

  const db = await getDb();
  const res = await db.query<unknown[]>(lets.join("\n"), bindings);
  return res[res.length - 1] as GenericResult<SharedRecordContract>;
}

// ----------------------------------------------------------------------------
// EDIT SHARE
// ----------------------------------------------------------------------------

export async function editShare(
  sharedRecordId: string,
  updates: {
    permissions: string[];
    fields?: string[];
    table?: string;
    cascade?: CascadeChild[];
  },
  caller: Tenant,
): Promise<GenericResult<SharedRecordContract | null>> {
  if (updates.table) {
    assertSafe("ident", updates.table, `table:${updates.table}`);
  }
  assertSafeCascade(updates.cascade, "editShare.cascade");
  const e = await getCascadeTableError(updates.cascade, "read");
  if (e) return failV("cascade", e);
  if (!updates.table) return failV("table", "common.error.required");
  if (isSensitive(updates.table)) {
    return failV("table", "common.error.securityTableNotShareable");
  }
  if (!(await tableHasField(updates.table, "tenantIds"))) {
    return failV("table", "common.error.notSupported");
  }

  const perms = sanitizePerms(updates.permissions);
  if (perms.length !== updates.permissions.length) {
    return failV("permissions", "common.error.invalidPermissions");
  }
  if (updates.fields) {
    try {
      assertSafeFieldPaths(updates.fields, "editShare.fields");
    } catch {
      return failV("fields", "common.error.unsafeField");
    }
  }

  if (updates.fields !== undefined) {
    const fe = await validateShareFieldsForTree(
      updates.table,
      updates.cascade,
      updates.fields,
      "fields",
    );
    if (fe) return { success: false, errors: fe };
  }
  if (!hasTenantSelector(caller)) {
    return { success: false, errors: tenantSelectorErr("caller") };
  }

  const bindings: Record<string, unknown> = {
    __sid: rid(sharedRecordId),
    __perms: perms,
    __hasFieldUpdate: updates.fields !== undefined,
    __newFieldsInput: updates.fields ?? [],
  };
  const callerMatch = buildCallerTenantsSQL(caller, "_es");
  Object.assign(bindings, callerMatch.bindings);
  const cm = callerMatch.sql;

  const lets: string[] = [
    `LET $__sr = (SELECT * FROM shared_record WHERE id = $__sid LIMIT 1)[0];`,
    `IF $__sr = NONE THEN RETURN { success: false, errors: [{ field: "id", errors: ["common.error.notFound"] }] } END;`,
    `LET $__recordTenantIds = <set>((SELECT VALUE tenantIds FROM ${updates.table}
        WHERE id = $__sr.recordId LIMIT 1)[0] ?? []);`,
    `LET $__targetFields = IF set::len($__perms) = 0 THEN $__sr.fields ELSE IF $__hasFieldUpdate THEN $__newFieldsInput ELSE $__sr.fields END END;`,
    `LET $__isOwner = $__recordTenantIds CONTAINSANY ${cm};`,
    `LET $__callerPerms = ${
      callerPermsForFieldsSQL(
        "$__sr.recordId",
        cm,
        "$__targetFields",
        "$__isOwner",
        "$__recordTenantIds",
      )
    };`,
    `LET $__canAct = $__isOwner OR $__callerPerms CONTAINS "share";`,
    `IF NOT $__canAct THEN RETURN { success: false, errors: [{ field: "auth", errors: ["common.error.forbidden"] }] } END;`,
    `LET $__newPerms = IF $__isOwner THEN $__perms ELSE set::intersect($__perms, $__callerPerms) END;`,
    `LET $__fieldsOk = ${
      callerCanShareFieldsSQL(
        "$__sr.recordId",
        cm,
        "$__targetFields",
        "$__isOwner",
        "$__recordTenantIds",
      )
    };`,
    `LET $__isDeleteRequest = set::len($__perms) = 0;`,
  ];

  if (updates.cascade?.length && updates.table) {
    lets.push(
      `LET $__rootEditAllowed = $__fieldsOk AND ($__isDeleteRequest OR set::len($__newPerms) > 0);`,
      `LET $__rootIdSet = IF $__rootEditAllowed THEN [$__sr.recordId] ELSE [] END;`,
    );
    const rawCol = await collectCascadeIds(
      updates.cascade,
      updates.table,
      "__rootIdSet",
      undefined,
      "share",
      "es_raw",
      "raw",
    );
    const col = await collectCascadeIds(
      updates.cascade,
      updates.table,
      "__rootIdSet",
      caller,
      "share",
      "es",
      "any",
    );
    lets.push(...rawCol.lets, ...col.lets);
    Object.assign(bindings, rawCol.bindings, col.bindings);
    lets.push(
      ...await coverageGuardForKind(rawCol.nodes, col.nodes, "shareable"),
    );
    const shareNodes = await filterNodes(col.nodes, "shareable");
    lets.push(...buildCascadeShareEditSQL(
      shareNodes,
      cm,
      "$__sr",
      "$__perms",
      "$__newPerms",
      "$__hasFieldUpdate",
      "$__newFieldsInput",
    ));
  }

  lets.push(
    `IF NOT $__fieldsOk THEN RETURN { success: false, errors: [{ field: "fields", errors: ["common.error.forbidden"] }] } END;`,
    `IF set::len($__perms) = 0 THEN DELETE shared_record WHERE id = $__sid; RETURN { success: true, data: NONE }; END;`,
    `IF set::len($__newPerms) = 0 THEN RETURN { success: false, errors: [{ field: "permissions", errors: ["common.error.forbidden"] }] } END;`,
    `LET $__updated = (UPDATE shared_record SET permissions = $__newPerms, fields = $__targetFields WHERE id = $__sid RETURN AFTER)[0];`,
    `RETURN { success: true, data: $__updated };`,
  );

  const db = await getDb();
  const res = await db.query<unknown[]>(lets.join("\n"), bindings);
  return res[res.length - 1] as GenericResult<SharedRecordContract | null>;
}
