"use client";

import { useMemo } from "react";
import { useTenantContext } from "@/src/hooks/useTenantContext";
import type { HourlyViewProps } from "@/src/contracts/high-level/component-props";

export default function HourlyView({
  value,
  className,
}: HourlyViewProps) {
  const { timezoneOffsetMinutes } = useTenantContext();

  const formatted = useMemo(() => {
    if (!value) return "";

    const match = value.match(/^(\d{1,2}):00$/);
    if (!match) return value;

    const dbHour = parseInt(match[1], 10);
    if (isNaN(dbHour) || dbHour < 0 || dbHour > 23) return value;

    const refUtcMs = Date.UTC(2000, 0, 1, dbHour, 0, 0);
    const trueUtcMs = refUtcMs - timezoneOffsetMinutes * 60 * 1000;
    const localHour = new Date(trueUtcMs).getHours();

    return `${String(localHour).padStart(2, "0")}:00`;
  }, [value, timezoneOffsetMinutes]);

  return (
    <span className={className ?? "text-sm text-[var(--color-light-text)]"}>
      {formatted}
    </span>
  );
}
