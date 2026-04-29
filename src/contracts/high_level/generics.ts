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
}
