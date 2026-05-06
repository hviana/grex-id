import type { Tenant } from "../tenant";

// ============================================================================
// Field-level types
// ============================================================================

/** Field encryption modes supported by genericCreate / genericUpdate. */
export type FieldEncryptionMode =
  | "aes-256-gcm"
  | "argon2-hash";

/** Declares how a single field should be processed by generic queries. */
export interface FieldSpec {
  field: string;
  entity?: string;
  unique?: boolean;
  encryption?: FieldEncryptionMode;
}

/** Field spec for genericDecrypt. */
export interface DecryptFieldSpec {
  field: string;
  optional?: boolean;
}

// ============================================================================
// Cascade types
// ============================================================================

export interface CascadeChild {
  table: string;
  parentField?: string;
  sourceField?: string;
  isArray?: boolean;
  children?: CascadeChild[];
  listOptions?: GenericListOptions;
  onDelete?: CascadeDeleteAction;
  select?: SelectSpec;
  accessFields?: string[];
  countAccessFields?: string[];
  resultIsArray?: boolean;
}

export type CascadeResult = Record<
  string,
  Record<string, unknown> | Record<string, unknown>[] | null
>;

export type WithCascade<T> = T & { _cascade?: CascadeResult };

// ============================================================================
// Filter types
// ============================================================================

export interface TagFilter {
  tagsColumn?: string;
  tagNames: string[];
}

export interface DateRangeFilter {
  start?: string;
  end?: string;
}

// ============================================================================
// Query options
// ============================================================================

export interface GenericListOptions {
  table: string;
  select?: SelectSpec;
  orderBy?: string;
  searchFields?: string[];
  dateRangeField?: string;
  extraConditions?: string[];
  extraBindings?: Record<string, unknown>;
  cascade?: CascadeChild[];
  /** Skip tenant-based access control. Use only in pre-authentication contexts
   *  (login, 2FA login-link) or superuser admin routes where no tenant context
   *  exists yet. */
  skipAccessCheck?: boolean;
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
  cascade?: CascadeChild[];
  /** Skip tenant-based access control. Use only in pre-authentication contexts
   *  (login, 2FA login-link) where no tenant context exists yet. */
  skipAccessCheck?: boolean;
  /** Skip standardize/validate field pipeline. Data must already be DB-ready.
   *  Used by db-changes apply() for pre-verified verification_request payloads. */
  skipFieldPipeline?: boolean;
}

export interface ListSharedRecordsOptions {
  recordId?: string;
  tenant?: Tenant;
  limit?: number;
  cursor?: string;
}

// ============================================================================
// Result types
// ============================================================================

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

export interface GenericDeleteResult {
  success: boolean;
  deleted: boolean;
  orphaned: boolean;
  cascaded?: string[];
  errorKey?: string;
}

// ============================================================================
// Permission, validation, and standardization function signatures
// ============================================================================

/** Permission level for shared_record access. */
export type Permission = "r" | "w" | "share";

/** Validator function signature — returns i18n error keys. */
export type ValidatorFn = (value: unknown) => Promise<string[]>;

/** Standardizer function signature. */
export type StandardizerFn = (value: string) => Promise<string>;
/**
 * A single visited node in a cascade id collection. `idsVar` names the LET
 * variable holding the authorized child-row ids at that level.
 */
export interface CascadeNodeInfo {
  table: string;
  idsVar: string;
  parentTable: string;
  parentIdsVar: string;
  sourceField?: string;
  parentField?: string;
  isArray: boolean;
}
export interface CascadePlan {
  sourceField: string;
  varName: string;
  isArray: boolean;
  children: CascadePlan[];
}

export interface CascadeBuilder {
  letStatements: string[];
  returnFields: string[];
  bindings: Record<string, unknown>;
  counter: { n: number };
}

// ============================================================================
// Access-control clause builder
// ----------------------------------------------------------------------------
// Two modes:
//   "any"    → row authorized by tenantIds membership OR by a shared_record
//              granting the requested permission. Default mode.
//   "tenant" → row authorized by tenantIds membership ONLY. Shared_records
//              have no authority here. Used by associate/disassociate which
//              mutate tenantIds directly.
// ============================================================================

export type AccessMode = "any" | "tenant";

/** Data to populate on a cascade child during genericCreate. */
export interface CascadeCreateChild {
  /** Must match a CascadeChild.table declared in opts.cascade at the same depth. */
  table: string;
  /** One or more rows to create at this cascade level. */
  rows: Record<string, unknown>[];
  /** Per-field validation specs (same shape as root FieldSpec[]). */
  fields?: FieldSpec[];
  /** Nested payloads for deeper cascade levels. */
  children?: CascadeCreateChild[];
}

/** Data to apply on a cascade child during genericUpdate. */
export interface CascadeUpdateChild {
  /** Must match a CascadeChild.table declared in opts.cascade at the same depth. */
  table: string;
  /** Partial update applied to EVERY accessible descendant row at this level. */
  data: Record<string, unknown>;
  /** Per-field validation specs. */
  fields?: FieldSpec[];
  /** Nested payloads for deeper cascade levels. */
  children?: CascadeUpdateChild[];
}

export type SelectSpec = string | string[] | undefined;
export type CascadeDeleteAction = "delete" | "detach" | "restrict";
export type Keyed<T> = T & { key?: string; cascadeKey?: string };
export type KChild = Keyed<CascadeChild> & {
  onDelete?: CascadeDeleteAction;
  select?: SelectSpec;
  accessFields?: string[];
  countAccessFields?: string[];
  resultIsArray?: boolean;
};
export type KNode = CascadeNodeInfo & { onDelete?: CascadeDeleteAction };
export type ExpandMode = AccessMode | "raw";
export type ResolveMode = "existing" | "resolveOrCreate";

export type PrivOpt = {
  allowSensitiveGlobalMutation?: boolean;
  allowSensitiveGlobalRead?: boolean;
};
export type RawCondOpt = { allowRawExtraConditions?: boolean };
export type TenantCreateOpt = { allowCreateCallerTenant?: boolean };
export type CascadeUpdOpt = {
  cascadeGateFields?: string[];
  cascadeTouch?: boolean;
};
export type ExtraAccOpt = { extraAccessFields?: string[] };

export type ReadPlan = Omit<CascadePlan, "children"> & {
  children: ReadPlan[];
  attachField: string;
  parentField?: string;
  isParentLink: boolean;
  resultIsArray: boolean;
};
