"use client";

import { useEffect, useRef, useState } from "react";
import type { TextFilterProps } from "@/src/contracts/high-level/filters";
import FilterBadge from "@/src/components/shared/FilterBadge";

function TextFilter(
  { value = "", onChange, placeholder, debounceMs = 300 }: TextFilterProps,
) {
  const [input, setInput] = useState(value);
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const timer = setTimeout(() => onChange(input), debounceMs);
    return () => clearTimeout(timer);
  }, [input, debounceMs, onChange]);

  return (
    <input
      type="text"
      value={input}
      onChange={(e) => setInput(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded border border-[var(--color-dark-gray)] bg-white/5 px-3 py-1.5 text-sm text-white placeholder-white/30 outline-none"
    />
  );
}

TextFilter.getBadge = (
  value: unknown,
  onChange: (key: string, value: unknown) => void,
  filterKey: string,
) => {
  if (typeof value !== "string" || !value) return null;
  return (
    <FilterBadge
      label={value}
      filterKey={filterKey}
      onChange={onChange}
    />
  );
};

export default TextFilter;
