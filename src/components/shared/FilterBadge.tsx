"use client";
import type { FilterBadgeProps } from "@/src/contracts/high-level/component-props";

export default function FilterBadge(
  { label, filterKey, onChange }: FilterBadgeProps,
) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-primary-green)]/10 border border-[var(--color-primary-green)]/30 px-3 py-1 text-xs text-[var(--color-primary-green)]">
      {label}
      <button
        onClick={() => onChange(filterKey, "")}
        className="hover:text-white transition-colors ml-1"
        aria-label={`Remove filter: ${label}`}
      >
        ✕
      </button>
    </span>
  );
}
