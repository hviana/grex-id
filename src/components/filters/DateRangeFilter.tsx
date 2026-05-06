"use client";

import { useState } from "react";
import DateSubForm from "@/src/components/subforms/DateSubForm";
import { useTenantContext } from "@/src/hooks/useTenantContext";
import FilterBadge from "@/src/components/shared/FilterBadge";
import type { DateRangeFilterProps } from "@/src/contracts/high-level/filters";

function DateRangeFilter(
  { maxRangeDays, mode = "date", onChange }: DateRangeFilterProps,
) {
  const { t } = useTenantContext();
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleChange = (newStart: string, newEnd: string) => {
    setError(null);
    if (newStart && newEnd) {
      const s = new Date(newStart);
      const e = new Date(newEnd);
      const diffDays = (e.getTime() - s.getTime()) / 86400000;

      if (diffDays < 0) {
        setError(t("common.dateRange.endBeforeStart"));
        return;
      }
      if (diffDays > maxRangeDays) {
        setError(
          t("common.dateRange.maxDays", { max: String(maxRangeDays) }),
        );
        return;
      }
      onChange(s, e);
    }
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="w-full sm:w-auto">
        <DateSubForm
          mode={mode}
          onChange={(v) => {
            setStart(v);
            handleChange(v, end);
          }}
        />
      </div>
      <span className="text-[var(--color-light-text)] text-sm hidden sm:inline">
        —
      </span>
      <div className="w-full sm:w-auto">
        <DateSubForm
          mode={mode}
          onChange={(v) => {
            setEnd(v);
            handleChange(start, v);
          }}
        />
      </div>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}

export default DateRangeFilter;

DateRangeFilter.getBadge = (
  value: unknown,
  onChange: (key: string, value: unknown) => void,
  filterKey: string,
) => {
  if (!Array.isArray(value) || value.length < 2) return null;
  const [start, end] = value as [Date, Date];
  if (!start || !end) return null;
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return (
    <FilterBadge
      label={`${fmt(start)} — ${fmt(end)}`}
      filterKey={filterKey}
      onChange={onChange}
    />
  );
};
