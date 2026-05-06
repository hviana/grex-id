"use client";

import type {
  FieldMapEntry,
  FieldType,
} from "@/src/contracts/high-level/common";
import { formatBytes, formatCurrency, formatPhone } from "@/src/lib/formatters";
import { useTenantContext } from "@/src/hooks/useTenantContext";
import DateView from "@/src/components/shared/DateView";
import type { GenericListItemProps } from "@/src/contracts/high-level/component-props";

function resolveValue(data: Record<string, unknown>, path: string): unknown {
  if (path in data) return data[path];
  const parts = path.split(".");
  let current: unknown = data;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function resolveType(entry: FieldType | FieldMapEntry): FieldType {
  return typeof entry === "string" ? entry : entry.type;
}

function resolveLabelKey(
  key: string,
  entry: FieldType | FieldMapEntry,
): string {
  if (typeof entry === "object" && entry.label) return entry.label;
  return key;
}

export default function GenericListItem(
  { data, fieldMap, controls }: GenericListItemProps,
) {
  const { t, locale } = useTenantContext();

  const formatValue = (value: unknown, type: FieldType): React.ReactNode => {
    if (value == null) return "—";
    const str = String(value);
    switch (type) {
      case "date":
        return <DateView mode="date" value={str} />;
      case "datetime":
        return <DateView mode="datetime" value={str} />;
      case "currency":
        return formatCurrency(Number(value), "USD", locale);
      case "boolean":
        return value ? "✅" : "❌";
      case "phone":
        return formatPhone(str);
      case "file":
        return formatBytes(Number(value));
      default:
        return str;
    }
  };

  return (
    <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-4 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-[var(--color-light-green)]/10 transition-all duration-200">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 space-y-1 min-w-0">
          {Object.entries(fieldMap).map(([key, entry]) => (
            <div key={key} className="flex gap-2 text-sm">
              <span className="text-[var(--color-light-text)] shrink-0">
                {t(resolveLabelKey(key, entry))}:
              </span>
              <span className="text-white truncate">
                {formatValue(resolveValue(data, key), resolveType(entry))}
              </span>
            </div>
          ))}
        </div>
        <div className="flex gap-2 shrink-0">{controls}</div>
      </div>
    </div>
  );
}
