// ============================================================================
// Shared component props, hook options, and utility types.
// Every React component, hook, and form imports Props/options from here.
// ============================================================================

import type { ReactNode } from "react";
import type { FieldMapEntry, FieldType } from "./common";
import type { CursorParams, PaginatedResult } from "./pagination";
import type {
  BadgeValue,
  ChannelAction,
  KeyValueEntry,
  SubformConfig,
  TranslatedBadgeKind,
} from "./components";
import type { FilterDefinition } from "./filters";
import type { MenuItemTree } from "./menu-item";
import type {
  TenantFieldName,
  TenantFormData,
  TenantViewData,
} from "./tenant-display";
import type { ResourceLimitsData } from "./resource-limits";
import type { UserViewData } from "./user";
import type { LeadViewData } from "./lead";
import type { ApiTokenView } from "./tokens";
import type { UsageData } from "./usage";
import type { CoreCreditExpenseRow } from "./query-results";

// ============================================================================
// Hook / utility types
// ============================================================================

export interface UseLiveQueryOptions<T> {
  query: string;
  bindings?: Record<string, unknown>;
  enabled?: boolean;
}

export type ResizeOptions =
  & { format: string }
  & (
    | { width: number; height: number }
    | { width: number; height?: undefined }
    | { width?: undefined; height: number }
  );

// ============================================================================
// Shared component props
// ============================================================================

export interface GenericListProps<T extends Record<string, unknown>> {
  entityName: string;
  searchEnabled?: boolean;
  createEnabled?: boolean;
  filters?: FilterDefinition[];
  fetchFn: (
    params: CursorParams & {
      search?: string;
      filters?: Record<string, unknown>;
    },
  ) => Promise<PaginatedResult<T>>;
  renderItem?: (item: T, controls: ReactNode) => ReactNode;
  fieldMap?: Record<string, FieldType | FieldMapEntry>;
  controlButtons?: ("edit" | "delete")[];
  actionComponents?: {
    key: string;
    component: React.ComponentType<{ item: T }>;
  }[];
  debounceMs?: number;
  formSubforms?: SubformConfig[];
  createRoute?: string;
  editRoute?: (id: string) => string;
  deleteRoute?: (id: string) => string;
  fetchOneRoute?: (id: string) => string;
  authToken?: string | null;
  extraData?: Record<string, unknown>;
  onCreateClick?: () => void;
  reloadKey?: number | string;
  onFiltersChange?: (values: Record<string, unknown>) => void;
  emptyState?: ReactNode;
}

export interface GenericListItemProps {
  data: Record<string, unknown>;
  fieldMap: Record<string, FieldType | FieldMapEntry>;
  controls: ReactNode;
}

export interface FormModalProps {
  title: string;
  subforms: SubformConfig[];
  submitRoute: string;
  method: "POST" | "PUT";
  initialData?: Record<string, unknown>;
  onSuccess: () => void;
  onClose: () => void;
  authToken?: string | null;
  extraData?: Record<string, unknown>;
}

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

export interface SidebarProps {
  menus: MenuItemTree[];
  systemLogo?: string;
  systemName?: string;
  activeComponent?: string;
  onNavigate: (componentName: string) => void;
}

export interface SidebarMenuItemProps {
  item: MenuItemTree;
  depth?: number;
  searchQuery?: string;
  activeComponent?: string;
  onNavigate: (componentName: string) => void;
}

export interface SidebarSearchProps {
  value: string;
  onChange: (value: string) => void;
}

export interface CreateButtonProps {
  onClick: () => void;
  label?: string;
}

export interface EditButtonProps {
  onClick: () => void;
  loading?: boolean;
}

export interface DeleteButtonProps {
  onConfirm: () => Promise<void>;
}

export interface GenericFormButtonProps {
  loading: boolean;
  label: string;
  disabled?: boolean;
}

export interface SpinnerProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

export interface ErrorDisplayProps {
  message: string | null;
  errors?: string[];
}

export interface FilterBadgeProps {
  label: string;
  filterKey: string;
  onChange: (key: string, value: unknown) => void;
}

export interface FilterDropdownProps {
  filters: FilterDefinition[];
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}

export type {
  DateRangeFilterProps,
  FilterComponentProps,
  FilterDefinition,
  FilterGetBadge,
  MultiBadgeFieldFilterProps,
  TextFilterProps,
} from "./filters";

export interface SearchFieldProps {
  onSearch: (query: string) => void;
  debounceMs?: number;
  placeholder?: string;
}

export interface BotProtectionProps {
  onVerified: (token: string) => void;
}

export interface TagSearchProps {
  value: string[];
  onChange: (tagIds: string[]) => void;
  label?: string;
  debounceMs?: number;
}

export interface SystemBrandingProps {
  systemInfo: { name: string; slug: string; logoUri?: string } | null;
  loading?: boolean;
}

export interface AccessRequestModalProps {
  entityType: string;
  entityId: string;
  entityLabel?: string;
  isRestricted?: boolean;
  /** Optional list of field names that can be scoped on the share. */
  shareableFields?: string[];
  onSuccess: () => void;
  onClose: () => void;
}

export interface RemoveAccessModalProps {
  entityType: string;
  entityId: string;
  entityLabel?: string;
  showPermission?: boolean;
  onSuccess: () => void;
  onClose: () => void;
}

export interface DownloadDataProps {
  data:
    | Record<string, unknown>[]
    | (() => Promise<Record<string, unknown>[]>);
  fileName?: string;
  sheetName?: string;
  label?: string;
}

export interface TranslatedBadgeProps {
  kind: TranslatedBadgeKind;
  token: string;
  systemSlug?: string;
  frameworkName?: string;
  onRemove?: () => void;
  compact?: boolean;
}

export interface TranslatedBadgeListProps {
  kind: TranslatedBadgeKind;
  tokens?: string[];
  entries?: Record<string, string | number> | null;
  systemSlug?: string;
  frameworkName?: string;
  compact?: boolean;
  mode?: "row" | "column";
  title?: string;
  emptyText?: string;
  prefix?: ReactNode | ((token: string) => ReactNode);
  leading?: ReactNode;
  formatValue?: (value: string | number) => ReactNode;
  className?: string;
  justifyValues?: boolean;
}

export interface TenantViewProps {
  tenant: TenantViewData;
  visibleFields?: TenantFieldName[];
  compact?: boolean;
}

export interface UserViewProps {
  user: UserViewData;
  systemSlug?: string;
  controls?: ReactNode;
  groupNames?: string[];
}

export interface LeadViewProps {
  lead: LeadViewData;
  systemSlug?: string;
  customActions?: ReactNode;
}

export interface TokenViewProps {
  token: ApiTokenView;
  systemSlug?: string;
  controls?: ReactNode;
}

export interface ResourceLimitsViewProps {
  data: ResourceLimitsData;
  systemSlug?: string;
  title?: string;
  className?: string;
  modifier?: boolean;
}

export interface UsagePageProps {
  mode?: "tenant" | "core";
}

// ============================================================================
// Field component props
// ============================================================================

export interface TransformResult {
  data: Uint8Array;
  type: string;
}

export interface FileUploadFieldProps {
  fieldName: string;
  allowedExtensions: string[];
  maxSizeBytes: number;
  companyId: string;
  systemSlug: string;
  category: string[];
  previewEnabled?: boolean;
  descriptionEnabled?: boolean;
  currentUri?: string;
  transformFn?: (file: File) => Promise<TransformResult>;
  onComplete: (uri: string) => void;
  onRemove?: () => void;
}

export interface SearchableSelectFieldProps {
  fetchFn: (search: string) => Promise<{ id: string; label: string }[]>;
  debounceMs?: number;
  multiple?: boolean;
  onChange: (selected: { id: string; label: string }[]) => void;
  initialSelected?: { id: string; label: string }[];
  showAllOnEmpty?: boolean;
  placeholder?: string;
}

export interface DynamicKeyValueFieldProps {
  fields: KeyValueEntry[];
  onChange: (fields: KeyValueEntry[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  descriptionPlaceholder?: string;
  addLabel?: string;
  showDescription?: boolean;
}

export interface MultiBadgeFieldProps {
  name: string;
  mode: "custom" | "search";
  value: BadgeValue[];
  onChange: (value: BadgeValue[]) => void;
  fetchFn?: (search: string) => Promise<BadgeValue[]>;
  staticOptions?: BadgeValue[];
  formatHint?: string;
  debounceMs?: number;
  hideLabel?: boolean;
  renderBadge?: (item: BadgeValue, remove: () => void) => ReactNode;
}

// ============================================================================
// Subform component props
// ============================================================================

export interface CreditCardSubformProps {
  initialData?: Record<string, unknown>;
}

export interface VoucherSubformProps {
  initialData?: Record<string, unknown>;
}

export interface LeadCoreSubformProps {
  initialData?: Record<string, unknown>;
  hideTags?: boolean;
  companyId?: string;
  systemId?: string;
  systemSlug?: string;
}

export interface ProfileSubformProps {
  initialData?: Record<string, unknown>;
  companyId?: string;
  systemSlug?: string;
  hideAvatar?: boolean;
}

export interface TwoFactorSubformProps {
  twoFactorEnabled: boolean;
  onRequested?: () => void;
}

export interface NameDescSubformProps {
  initialData?: Record<string, unknown>;
  requiredFields?: string[];
  visibleFields?: string[];
  maxNameLength?: number;
  maxDescriptionLength?: number;
}

export interface CompanyIdentificationSubformProps {
  initialData?: Record<string, unknown>;
}

export interface PasswordSubformProps {
  initialData?: Record<string, unknown>;
  requiredFields?: string[];
}

export interface UserSubformProps {
  initialData?: Record<string, unknown>;
  isCreate?: boolean;
  systemSlug?: string;
  systemId?: string;
}

export interface PlanSubformProps {
  initialData?: Record<string, unknown>;
}

export interface OwnerSubformProps {
  initialData?: Record<string, unknown>;
}

export interface AddressSubformProps {
  initialData?: Record<string, unknown>;
  fieldPrefix?: string;
}

export interface PaymentMethodSubformProps {
  initialData?: Record<string, unknown>;
  showDefaultToggle?: boolean;
}

export interface AddressInput {
  street: string;
  number: string;
  complement?: string;
  neighborhood?: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
}

export interface PaymentMethodSubmitData {
  type: string;
  isDefault: boolean;
  cardToken: string;
  cardMask: string;
  holderName: string;
  holderDocument: string;
  billingAddress: AddressInput;
}

export interface ResourceLimitsSubformProps {
  valueMode: "absolute" | "modifier";
  initialData?: Record<string, unknown>;
  systemSlug?: string;
  systemId?: string;
  initialGranular?: boolean;
}

export interface TenantSubformProps {
  initialData?: Partial<TenantFormData>;
  visibleFields?: TenantFieldName[];
  requiredFields?: TenantFieldName[];
  initialGranular?: boolean;
  systemId?: string;
  onFieldChange?: (field: string, value: unknown) => void;
}

export interface DateSubFormProps {
  /** "date" for date-only, "datetime" for date+time. */
  mode: "date" | "datetime";
  /** Initial value in the DB timezone (ISO string). */
  initialDate?: string;
  /** Label for the field. */
  label?: string;
  /** Whether the field is required. */
  required?: boolean;
  /** Fires with the converted value (ISO string in DB timezone) on every change. */
  onChange?: (value: string) => void;
}

export interface DateViewProps {
  /** "date" for date-only, "datetime" for date+time. */
  mode: "date" | "datetime";
  /** The DB-stored date/datetime value (ISO string in DB timezone). */
  value: string;
  /** Optional className for the wrapper. */
  className?: string;
}

export interface HourlyViewProps {
  /** The hour label in DB timezone format "HH:00" (e.g. "09:00"). */
  value: string;
  /** Optional className for the wrapper. */
  className?: string;
}

export interface ChannelActionsProps {
  channels: { type: string; value: string }[];
  actions: ChannelAction[];
}

// ============================================================================
// Core component props
// ============================================================================

export interface SystemFormProps {
  initialData?: Record<string, unknown>;
}

export interface RoleFormProps {
  initialData?: Record<string, unknown>;
  initialGranular?: boolean;
}

export interface SettingsEditorProps {
  mode?: "core" | "front";
}
