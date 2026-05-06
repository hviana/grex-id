"use client";

import { useEffect, useState } from "react";
import { useDebounce } from "@/src/hooks/useDebounce";
import Spinner from "@/src/components/shared/Spinner";
import { useTenantContext } from "@/src/hooks/useTenantContext";
import type { SearchableSelectFieldProps } from "@/src/contracts/high-level/component-props";

export default function SearchableSelectField({
  fetchFn,
  debounceMs = 300,
  multiple = false,
  onChange,
  initialSelected = [],
  showAllOnEmpty = false,
  placeholder,
}: SearchableSelectFieldProps) {
  const { t } = useTenantContext();
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<{ id: string; label: string }[]>([]);
  const [selected, setSelected] = useState<{ id: string; label: string }[]>(
    initialSelected,
  );
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const debouncedSearch = useDebounce(search, debounceMs);

  useEffect(() => {
    if (!debouncedSearch && !showAllOnEmpty) {
      setOptions([]);
      return;
    }
    setLoading(true);
    fetchFn(debouncedSearch)
      .then(setOptions)
      .finally(() => setLoading(false));
  }, [debouncedSearch, fetchFn, showAllOnEmpty]);

  useEffect(() => {
    if (showAllOnEmpty && focused && !search) {
      setLoading(true);
      fetchFn("")
        .then(setOptions)
        .finally(() => setLoading(false));
    }
  }, [focused, showAllOnEmpty, search, fetchFn]);

  const add = (item: { id: string; label: string }) => {
    const next = multiple ? [...selected, item] : [item];
    setSelected(next);
    onChange(next);
    setSearch("");
    setOptions([]);
  };

  const remove = (id: string) => {
    const next = selected.filter((s) => s.id !== id);
    setSelected(next);
    onChange(next);
  };

  return (
    <div className="space-y-2">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selected.map((s) => (
            <span
              key={s.id}
              className="inline-flex items-center gap-1 rounded-full bg-[var(--color-secondary-blue)]/10 border border-[var(--color-secondary-blue)]/30 px-3 py-1 text-xs text-[var(--color-secondary-blue)]"
            >
              {s.label}
              <button
                onClick={() => remove(s.id)}
                className="hover:text-white ml-1"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 300)}
          placeholder={placeholder ?? t("common.search")}
          className="w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-[var(--color-primary-green)] transition-colors"
        />
        {loading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <Spinner size="sm" />
          </div>
        )}
        {options.length > 0 && focused && (
          <div className="absolute top-full left-0 right-0 mt-1 z-50 max-h-40 overflow-y-auto border border-[var(--color-dark-gray)] rounded-lg bg-[#111] shadow-lg">
            {options
              .filter((o) => !selected.some((s) => s.id === o.id))
              .map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => add(opt)}
                  className="w-full text-left px-4 py-2 text-sm text-[var(--color-light-text)] hover:bg-white/5 hover:text-white transition-colors"
                >
                  {opt.label}
                </button>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
