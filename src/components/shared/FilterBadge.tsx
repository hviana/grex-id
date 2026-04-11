"use client";

interface FilterBadgeProps {
  label: string;
  onRemove: () => void;
}

export default function FilterBadge({ label, onRemove }: FilterBadgeProps) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-primary-green)]/10 border border-[var(--color-primary-green)]/30 px-3 py-1 text-xs text-[var(--color-primary-green)]">
      {label}
      <button
        onClick={onRemove}
        className="hover:text-white transition-colors ml-1"
        aria-label={`Remove filter: ${label}`}
      >
        ✕
      </button>
    </span>
  );
}
