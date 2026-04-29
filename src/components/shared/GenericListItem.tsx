"use client";

import type { FieldType } from "@/src/contracts/high-level/common";
import {
  formatBytes,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatPhone,
} from "@/src/lib/formatters";
import { useTenantContext } from "@/src/hooks/useTenantContext";
import type { GenericListItemProps } from "@/src/contracts/high-level/component-props";

export default function GenericListItem(
  { data, fieldMap, controls }: GenericListItemProps,
) {
  const { locale } = useTenantContext();

  const formatValue = (value: unknown, type: FieldType): string => {
    if (value == null) return "—";
    const str = String(value);
    switch (type) {
      case "date":
        return formatDate(str, locale);
      case "datetime":
        return formatDateTime(str, locale);
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
          {Object.entries(fieldMap).map(([key, type]) => (
            <div key={key} className="flex gap-2 text-sm">
              <span className="text-[var(--color-light-text)] shrink-0">
                {key}:
              </span>
              <span className="text-white truncate">
                {formatValue(data[key], type)}
              </span>
            </div>
          ))}
        </div>
        <div className="flex gap-2 shrink-0">{controls}</div>
      </div>
    </div>
  );
}
