// ============================================================================
// Filter component contracts.
// Every filter component implements FilterComponentProps.
// Every filter module exports a getBadge function matching FilterGetBadge.
// ============================================================================

import type { ReactNode } from "react";
import type { BadgeValue } from "./components";

/** Base contract that every filter component must implement. */
export interface FilterComponentProps {
  onChange: (...args: any[]) => void;
}

/** Signature that every filter module's getBadge export must match. */
export type FilterGetBadge<TValue = unknown> = (
  value: TValue,
  onChange: (key: string, value: unknown) => void,
  filterKey: string,
) => ReactNode;

/** A filter component that also renders its own active-value badge. */
export type FilterComponentWithBadge = React.ComponentType<any> & {
  getBadge: FilterGetBadge;
};

/** Describes a filter instance passed to GenericList / FilterDropdown. */
export interface FilterDefinition {
  key: string;
  label: string;
  component: FilterComponentWithBadge;
  props?: Record<string, unknown>;
}

export interface TextFilterProps extends FilterComponentProps {
  onChange: (value: string) => void;
  value?: string;
  placeholder?: string;
  debounceMs?: number;
}

export interface MultiBadgeFieldFilterProps extends FilterComponentProps {
  onChange: (value: BadgeValue[]) => void;
  value?: BadgeValue[];
  name?: string;
  fetchFn?: (search: string) => Promise<BadgeValue[]>;
  staticOptions?: BadgeValue[];
  placeholder?: string;
  debounceMs?: number;
}

export interface DateRangeFilterProps extends FilterComponentProps {
  maxRangeDays: number;
  mode?: "date" | "datetime";
  onChange: (start: Date, end: Date) => void;
}
