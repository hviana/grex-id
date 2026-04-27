"use client";

import { useState } from "react";
import { useDebounce } from "@/src/hooks/useDebounce";
import { useEffect } from "react";
import { useTenantContext } from "@/src/hooks/useTenantContext";

interface SearchFieldProps {
  onSearch: (query: string) => void;
  debounceMs?: number;
  placeholder?: string;
}

export default function SearchField(
  { onSearch, debounceMs = 300, placeholder }: SearchFieldProps,
) {
  const { t } = useTenantContext();
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query, debounceMs);

  useEffect(() => {
    onSearch(debouncedQuery);
  }, [debouncedQuery, onSearch]);

  return (
    <input
      type="text"
      value={query}
      onChange={(e) => setQuery(e.target.value)}
      placeholder={placeholder ?? t("common.search")}
      className="w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-[var(--color-primary-green)] transition-colors"
    />
  );
}
