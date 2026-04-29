import type React from "react";

// ============================================================================
// Shared UI component contracts — cross-component types used by GenericList,
// FormModal, subforms, fields, and pages.
// ============================================================================

/** Subform component contract — every subform receives a ref and optional initial data. */
export interface SubformConfig {
  component: React.ComponentType<{
    ref: React.Ref<SubformRef>;
    initialData?: Record<string, unknown>;
    [key: string]: unknown;
  }>;
  key: string;
  extraProps?: Record<string, unknown>;
}

/** Subform imperative handle contract — collected by FormModal before submit. */
export interface SubformRef {
  getData(): Record<string, unknown>;
  isValid(): boolean;
}

/** Describes a filter control rendered by FilterDropdown inside GenericList. */
export interface FilterConfig {
  key: string;
  label: string;
  type: "text" | "select" | "dateRange";
  options?: { value: string; label: string }[];
}

/** Current filter values keyed by filter config key. */
export type FilterValues = Record<string, string>;

/** Badge value used by MultiBadgeField — string for simple tags, object for id+name pairs. */
export type BadgeValue = string | { id?: string; name: string; color?: string };

/** Identifier kind consumed by TranslatedBadge for key resolution (§2.3.1). */
export type TranslatedBadgeKind = "role" | "entity" | "resource" | "group";

/** Operating mode for EntityChannelsSubform. */
export type EntityChannelsSubformMode = "authenticated" | "local";

/** Props for the shared EntityChannelsSubform component. */
export interface EntityChannelsSubformProps {
  channelTypes: string[];
  requiredTypes?: string[];
  mode?: EntityChannelsSubformMode;
  initialData?: Record<string, unknown>;
  systemToken?: string;
}

/** A system option for dropdown/select controls (id + slug + name). */
export interface SystemOption {
  id: string;
  slug: string;
  name: string;
  logoUri?: string;
}

/** System list item used by core admin systems page. */
export interface SystemItem {
  id: string;
  name: string;
  slug: string;
  logoUri: string;
  createdAt: string;
  [key: string]: unknown;
}

/** Role list item used by core admin roles page. */
export interface RoleItem {
  id: string;
  name: string;
  systemId: string;
  isBuiltIn: boolean;
  createdAt: string;
  [key: string]: unknown;
}

/** A single key-value entry with description, used by DynamicKeyValueField. */
export interface KeyValueEntry {
  key: string;
  value: string;
  description: string;
}
