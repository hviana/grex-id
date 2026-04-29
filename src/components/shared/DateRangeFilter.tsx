"use client";

import { useState } from "react";
import { useTenantContext } from "@/src/hooks/useTenantContext";
import type { DateRangeFilterProps } from "@/src/contracts/high-level/component-props";

export default function DateRangeFilter(
  { maxRangeDays, onChange }: DateRangeFilterProps,
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
      <input
        type="date"
        value={start}
        onChange={(e) => {
          setStart(e.target.value);
          handleChange(e.target.value, end);
        }}
        className="rounded border border-[var(--color-dark-gray)] bg-white/5 px-3 py-1.5 text-sm text-white outline-none focus:border-[var(--color-primary-green)]"
      />
      <span className="text-[var(--color-light-text)] text-sm">—</span>
      <input
        type="date"
        value={end}
        onChange={(e) => {
          setEnd(e.target.value);
          handleChange(start, e.target.value);
        }}
        className="rounded border border-[var(--color-dark-gray)] bg-white/5 px-3 py-1.5 text-sm text-white outline-none focus:border-[var(--color-primary-green)]"
      />
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}
