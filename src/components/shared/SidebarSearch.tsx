"use client";

import { useLocale } from "@/src/hooks/useLocale";

interface SidebarSearchProps {
  value: string;
  onChange: (value: string) => void;
}

export default function SidebarSearch({ value, onChange }: SidebarSearchProps) {
  const { t } = useLocale();

  return (
    <div className="relative group">
      {/* Outer glow container on focus */}
      <div className="absolute -inset-px rounded-2xl opacity-0 group-focus-within:opacity-100 transition-opacity duration-500 bg-gradient-to-r from-[var(--color-primary-green)]/20 via-[var(--color-secondary-blue)]/10 to-[var(--color-primary-green)]/20 blur-sm pointer-events-none" />

      {/* Gradient border wrapper */}
      <div className="relative rounded-2xl p-px bg-gradient-to-r from-white/[0.06] via-white/[0.12] to-white/[0.06] group-focus-within:from-[var(--color-primary-green)]/30 group-focus-within:via-[var(--color-secondary-blue)]/20 group-focus-within:to-[var(--color-primary-green)]/30 transition-all duration-500">
        <div className="relative flex items-center rounded-[15px] bg-[#0c0c0c] overflow-hidden">
          {/* Search icon */}
          <span className="pl-3.5 text-sm text-white/25 group-focus-within:text-[var(--color-primary-green)] transition-colors duration-300 pointer-events-none select-none">
            🔍
          </span>
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={t("common.sidebar.search")}
            className="w-full bg-transparent pl-2.5 pr-3.5 py-2.5 text-sm text-white placeholder-white/30 outline-none"
          />
          {/* Clear button */}
          {value && (
            <button
              onClick={() => onChange("")}
              className="pr-3 text-white/30 hover:text-white/60 transition-colors text-xs"
            >
              ✕
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
