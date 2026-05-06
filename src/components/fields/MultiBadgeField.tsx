"use client";

import { useCallback, useRef, useState } from "react";
import { useDebounce } from "@/src/hooks/useDebounce";
import { useTenantContext } from "@/src/hooks/useTenantContext";
import Spinner from "@/src/components/shared/Spinner";
import type { BadgeValue } from "@/src/contracts/high-level/components";
import type { MultiBadgeFieldProps } from "@/src/contracts/high-level/component-props";

function getBadgeLabel(item: BadgeValue): string {
  return typeof item === "string" ? item : item.name;
}

function getBadgeColor(item: BadgeValue): string | undefined {
  return typeof item === "string" ? undefined : item.color;
}

export default function MultiBadgeField({
  name,
  mode,
  value,
  onChange,
  fetchFn,
  staticOptions,
  formatHint,
  debounceMs = 300,
  hideLabel = false,
  renderBadge,
}: MultiBadgeFieldProps) {
  const { t } = useTenantContext();
  const [input, setInput] = useState("");
  const [suggestions, setSuggestions] = useState<BadgeValue[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const debouncedInput = useDebounce(input, debounceMs);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastFetchRef = useRef("");

  const selectedLabels = new Set(value.map(getBadgeLabel));

  const updateSuggestions = useCallback(async (search: string) => {
    if (!search.trim()) {
      setSuggestions([]);
      return;
    }
    if (search === lastFetchRef.current) return;
    lastFetchRef.current = search;

    if (fetchFn) {
      setLoading(true);
      try {
        const results = await fetchFn(search);
        setSuggestions(
          results.filter((r) => !selectedLabels.has(getBadgeLabel(r))),
        );
      } finally {
        setLoading(false);
      }
    } else if (staticOptions) {
      const lower = search.toLowerCase();
      setSuggestions(
        staticOptions.filter(
          (opt) =>
            getBadgeLabel(opt).toLowerCase().includes(lower) &&
            !selectedLabels.has(getBadgeLabel(opt)),
        ),
      );
    }
  }, [fetchFn, staticOptions, selectedLabels]);

  const prevDebouncedRef = useRef(debouncedInput);
  if (prevDebouncedRef.current !== debouncedInput) {
    prevDebouncedRef.current = debouncedInput;
    updateSuggestions(debouncedInput);
  }

  const addValue = (item: BadgeValue) => {
    if (!selectedLabels.has(getBadgeLabel(item))) {
      onChange([...value, item]);
    }
    setInput("");
    setSuggestions([]);
    lastFetchRef.current = "";
  };

  const addFromInput = () => {
    if (mode === "custom" && input.trim()) {
      addValue(input.trim());
    } else if (mode === "search" && suggestions.length > 0) {
      addValue(suggestions[0]);
    }
  };

  const removeValue = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addFromInput();
    }
  };

  const handleBlur = () => {
    setTimeout(() => setShowDropdown(false), 200);
  };

  const filteredSuggestions = suggestions.filter(
    (s) => !selectedLabels.has(getBadgeLabel(s)),
  );

  const canAdd = mode === "custom"
    ? input.trim().length > 0
    : input.trim().length > 0 && filteredSuggestions.length > 0;

  return (
    <div ref={containerRef} className="space-y-2">
      {!hideLabel && (
        <label className="block text-sm font-medium text-[var(--color-light-text)]">
          {name}
        </label>
      )}

      <div className="relative">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setShowDropdown(true);
              }}
              onFocus={() => setShowDropdown(true)}
              onBlur={handleBlur}
              onKeyDown={handleKeyDown}
              placeholder={mode === "custom"
                ? formatHint ?? t("common.placeholder.typeAndEnter")
                : formatHint ?? t("common.placeholder.search")}
              className="w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-2.5 pr-10 text-white outline-none focus:border-[var(--color-primary-green)] transition-colors"
            />
            {loading && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <Spinner size="sm" />
              </div>
            )}
          </div>
          <button
            type="button"
            disabled={!canAdd}
            onClick={() => {
              addFromInput();
              inputRef.current?.focus();
            }}
            className={`shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-lg font-bold transition-all duration-200 ${
              canAdd
                ? "bg-[var(--color-primary-green)] text-black hover:bg-[var(--color-hover-green)] hover:scale-105 cursor-pointer"
                : "bg-white/5 text-[var(--color-light-text)]/40 border border-[var(--color-dark-gray)] cursor-not-allowed"
            }`}
            title={mode === "custom" ? "Add value" : "Add selected"}
          >
            +
          </button>
        </div>

        {showDropdown && filteredSuggestions.length > 0 && (
          <div className="absolute z-50 mt-1 w-full max-h-40 overflow-y-auto border border-[var(--color-dark-gray)] rounded-lg bg-[#111]/95 backdrop-blur-md shadow-lg">
            {filteredSuggestions.map((suggestion, idx) => {
              const label = getBadgeLabel(suggestion);
              const color = getBadgeColor(suggestion);
              return (
                <button
                  key={`${label}-${idx}`}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => addValue(suggestion)}
                  className="w-full text-left px-4 py-2 text-sm text-[var(--color-light-text)] hover:bg-white/5 hover:text-white transition-colors flex items-center gap-2"
                >
                  {color && (
                    <span
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: color }}
                    />
                  )}
                  {label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {formatHint && mode === "custom" && (
        <p className="text-xs text-[var(--color-light-text)]/60">
          {formatHint}
        </p>
      )}

      {value.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {value.map((item, idx) => {
            const label = getBadgeLabel(item);
            const color = getBadgeColor(item);
            if (renderBadge) {
              return (
                <span key={`${label}-${idx}`}>
                  {renderBadge(item, () => removeValue(idx))}
                </span>
              );
            }
            return (
              <span
                key={`${label}-${idx}`}
                className={color
                  ? "inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs border"
                  : "inline-flex items-center gap-1 rounded-full bg-[var(--color-primary-green)]/10 border border-[var(--color-primary-green)]/30 px-3 py-1 text-xs text-[var(--color-primary-green)]"}
                style={color
                  ? {
                    backgroundColor: `${color}20`,
                    borderColor: `${color}50`,
                    color: color,
                  }
                  : undefined}
              >
                {label}
                <button
                  type="button"
                  onClick={() => removeValue(idx)}
                  className="hover:text-white ml-1 transition-colors"
                >
                  ✕
                </button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
