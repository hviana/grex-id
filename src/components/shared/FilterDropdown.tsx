"use client";

import { useState } from "react";
import type {
  FilterConfig,
  FilterValues,
} from "@/src/contracts/high-level/components";
import type { FilterDropdownProps } from "@/src/contracts/high-level/component-props";

export default function FilterDropdown(
  { filters, values, onChange }: FilterDropdownProps,
) {
  const [open, setOpen] = useState(false);

  if (filters.length === 0) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="rounded-lg border border-[var(--color-dark-gray)] px-3 py-2 text-sm text-[var(--color-light-text)] hover:border-[var(--color-primary-green)] transition-colors flex items-center gap-1"
      >
        🔽 Filters
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-2 z-40 min-w-64 backdrop-blur-md bg-[#111]/95 border border-[var(--color-dark-gray)] rounded-lg p-4 space-y-3 shadow-lg">
          {filters.map((filter) => (
            <div key={filter.key}>
              <label className="block text-xs text-[var(--color-light-text)] mb-1">
                {filter.label}
              </label>
              {filter.type === "select"
                ? (
                  <select
                    value={values[filter.key] ?? ""}
                    onChange={(e) =>
                      onChange({ ...values, [filter.key]: e.target.value })}
                    className="w-full rounded border border-[var(--color-dark-gray)] bg-white/5 px-3 py-1.5 text-sm text-white outline-none"
                  >
                    <option value="" className="bg-[var(--color-black)]">
                      All
                    </option>
                    {filter.options?.map((opt) => (
                      <option
                        key={opt.value}
                        value={opt.value}
                        className="bg-[var(--color-black)]"
                      >
                        {opt.label}
                      </option>
                    ))}
                  </select>
                )
                : (
                  <input
                    type="text"
                    value={values[filter.key] ?? ""}
                    onChange={(e) =>
                      onChange({ ...values, [filter.key]: e.target.value })}
                    className="w-full rounded border border-[var(--color-dark-gray)] bg-white/5 px-3 py-1.5 text-sm text-white outline-none"
                  />
                )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
