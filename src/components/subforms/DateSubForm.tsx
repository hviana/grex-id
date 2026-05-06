"use client";

import { forwardRef, useImperativeHandle, useState } from "react";
import type { SubformRef } from "@/src/contracts/high-level/components";
import { useTenantContext } from "@/src/hooks/useTenantContext";
import type { DateSubFormProps } from "@/src/contracts/high-level/component-props";

/**
 * Formats a Date into a YYYY-MM-DD string using the browser's local timezone.
 */
function toLocalDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Formats a Date into a YYYY-MM-DDTHH:mm string using the browser's local timezone.
 */
function toLocalDateTimeString(d: Date): string {
  return `${toLocalDateString(d)}T${String(d.getHours()).padStart(2, "0")}:${
    String(d.getMinutes()).padStart(2, "0")
  }`;
}

/**
 * Converts a local date/datetime to the DB timezone.
 * The DB offset is in minutes (e.g. -180 for UTC-3).
 * We need to shift the local time so that the resulting ISO string represents
 * the same wall-clock instant in the DB timezone.
 */
function localToDb(
  localIso: string,
  dbOffsetMinutes: number,
): string {
  const d = new Date(localIso);
  const localOffsetMinutes = d.getTimezoneOffset();
  const diff = -localOffsetMinutes - dbOffsetMinutes;
  const adjusted = new Date(d.getTime() + diff * 60 * 1000);
  return adjusted.toISOString();
}

const DateSubForm = forwardRef<SubformRef, DateSubFormProps>(
  ({ mode, initialDate, label, required = false, onChange }, ref) => {
    const { t, timezoneOffsetMinutes } = useTenantContext();

    const [dateValue, setDateValue] = useState(() => {
      if (!initialDate) return "";
      // initialDate is an ISO string in DB timezone.
      // Parse it, then format using local Date methods so the <input>
      // shows the equivalent date/datetime in the user's own timezone.
      const d = new Date(initialDate);
      if (isNaN(d.getTime())) return "";
      return mode === "date" ? toLocalDateString(d) : toLocalDateTimeString(d);
    });

    useImperativeHandle(ref, () => ({
      getData: () => {
        if (!dateValue) return {};
        const converted = localToDb(dateValue, timezoneOffsetMinutes);
        return { date: converted };
      },
      isValid: () => {
        if (required && !dateValue) return false;
        return true;
      },
    }));

    const inputType = mode === "datetime" ? "datetime-local" : "date";

    return (
      <div>
        {label && (
          <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
            {t(label)} {required ? "*" : ""}
          </label>
        )}
        <input
          type={inputType}
          value={dateValue}
          onChange={(e) => {
            setDateValue(e.target.value);
            if (onChange) {
              if (!e.target.value) {
                onChange("");
              } else {
                const converted = localToDb(
                  e.target.value,
                  timezoneOffsetMinutes,
                );
                onChange(converted);
              }
            }
          }}
          required={required}
          className="w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-2.5 text-white placeholder-white/30 outline-none focus:border-[var(--color-primary-green)] transition-colors"
        />
      </div>
    );
  },
);

DateSubForm.displayName = "DateSubForm";
export default DateSubForm;
