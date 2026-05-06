"use client";

import { useEffect, useRef, useState } from "react";
import type { FilterDefinition } from "@/src/contracts/high-level/filters";
import type { FilterDropdownProps } from "@/src/contracts/high-level/component-props";
import { useTenantContext } from "@/src/hooks/useTenantContext";

export default function FilterDropdown(
  { filters, values, onChange }: FilterDropdownProps,
) {
  const { t } = useTenantContext();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  if (filters.length === 0) return null;

  const activeEntries = filters.filter(
    (f) => values[f.key] != null && values[f.key] !== "",
  );

  return (
    <>
      <div className="relative" ref={containerRef}>
        <button
          onClick={() => setOpen(!open)}
          className="rounded-lg border border-[var(--color-dark-gray)] px-3 py-2 text-sm text-[var(--color-light-text)] hover:border-[var(--color-primary-green)] transition-colors flex items-center gap-1"
        >
          🔽 {t("common.filters")}
          {activeEntries.length > 0 && (
            <span className="text-[var(--color-primary-green)] text-xs">
              ({activeEntries.length})
            </span>
          )}
        </button>

        {open && (
          <div className="absolute top-full left-0 mt-2 z-50 min-w-64 backdrop-blur-md bg-[#111]/95 border border-[var(--color-dark-gray)] rounded-lg p-4 space-y-3 shadow-lg">
            {filters.map((def) => {
              const Component = def.component;
              return (
                <div key={def.key}>
                  <label className="block text-xs text-[var(--color-light-text)] mb-1">
                    {def.label}
                  </label>
                  <Component
                    {...def.props}
                    value={values[def.key]}
                    onChange={(...args: any[]) => {
                      const value = args.length === 1 ? args[0] : args;
                      onChange(def.key, value);
                    }}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {activeEntries.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {activeEntries.map((def) => (
            <div key={def.key}>
              {def.component.getBadge(values[def.key], onChange, def.key)}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
