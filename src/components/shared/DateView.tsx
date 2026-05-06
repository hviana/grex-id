"use client";

import { useMemo } from "react";
import { useTenantContext } from "@/src/hooks/useTenantContext";
import type { DateViewProps } from "@/src/contracts/high-level/component-props";

/**
 * Displays a DB-stored date/datetime converted to the user's local timezone.
 *
 * - mode="date": shows date only (e.g. "2024-03-15")
 * - mode="datetime": shows date and time (e.g. "2024-03-15 14:30")
 */
export default function DateView({
  mode,
  value,
  className,
}: DateViewProps) {
  const { timezoneOffsetMinutes } = useTenantContext();

  const formatted = useMemo(() => {
    if (!value) return "";
    const d = new Date(value);
    if (isNaN(d.getTime())) return value;

    // The value is in DB timezone (offset = timezoneOffsetMinutes from UTC).
    // JavaScript Date parses ISO as UTC. We need to display the wall-clock
    // time in the DB timezone, then let the browser convert to local time.
    //
    // Actually, the ISO string from the DB represents a moment in time.
    // When parsed by Date(), it's correct UTC. The browser's toLocaleString
    // will show the user's local time automatically.
    //
    // But if the DB stores wall-clock time (not UTC), we need to offset.
    // Since we store ISO strings shifted to DB timezone, we undo that shift
    // to get the true UTC instant, then display locally.

    // Undo the DB timezone shift to get the true UTC moment
    const trueUtc = new Date(d.getTime() - timezoneOffsetMinutes * 60 * 1000);

    if (mode === "date") {
      return trueUtc.toLocaleDateString(undefined, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
    }

    return trueUtc.toLocaleString(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }, [value, mode, timezoneOffsetMinutes]);

  return (
    <span className={className ?? "text-sm text-[var(--color-light-text)]"}>
      {formatted}
    </span>
  );
}
