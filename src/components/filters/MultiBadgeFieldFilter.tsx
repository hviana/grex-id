"use client";

import MultiBadgeField from "@/src/components/fields/MultiBadgeField";
import FilterBadge from "@/src/components/shared/FilterBadge";
import type { MultiBadgeFieldFilterProps } from "@/src/contracts/high-level/filters";
import type { BadgeValue } from "@/src/contracts/high-level/components";

function MultiBadgeFieldFilter(
  {
    value = [],
    onChange,
    name,
    fetchFn,
    staticOptions,
    placeholder,
    debounceMs,
  }: MultiBadgeFieldFilterProps,
) {
  return (
    <MultiBadgeField
      name={name ?? ""}
      mode="search"
      value={value}
      onChange={onChange}
      fetchFn={fetchFn}
      staticOptions={staticOptions}
      formatHint={placeholder}
      debounceMs={debounceMs}
    />
  );
}

MultiBadgeFieldFilter.getBadge = (
  value: unknown,
  onChange: (key: string, value: unknown) => void,
  filterKey: string,
) => {
  if (!Array.isArray(value) || value.length === 0) return null;
  const label = value
    .map((v: BadgeValue) => (typeof v === "string" ? v : v.name))
    .join(", ");
  return (
    <FilterBadge
      label={label}
      filterKey={filterKey}
      onChange={onChange}
    />
  );
};

export default MultiBadgeFieldFilter;
