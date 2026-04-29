"use client";

import type { ReactNode } from "react";
import TranslatedBadge from "./TranslatedBadge";
import type { TranslatedBadgeKind } from "@/src/contracts/high_level/components";

interface TranslatedBadgeListProps {
  kind: TranslatedBadgeKind;
  tokens?: string[];
  entries?: Record<string, string | number> | null;
  systemSlug?: string;
  frameworkName?: string;
  compact?: boolean;
  mode?: "row" | "column";
  title?: string;
  emptyText?: string;
  prefix?: ReactNode | ((token: string) => ReactNode);
  leading?: ReactNode;
  formatValue?: (value: string | number) => ReactNode;
  className?: string;
  justifyValues?: boolean;
}

export default function TranslatedBadgeList({
  kind,
  tokens,
  entries,
  systemSlug,
  frameworkName,
  compact = false,
  mode = "row",
  title,
  emptyText,
  prefix,
  leading,
  formatValue,
  className = "",
  justifyValues = false,
}: TranslatedBadgeListProps) {
  const tokenList = tokens?.filter(Boolean) ?? [];
  const entryList = entries
    ? Object.entries(entries).filter(([key]) => key)
    : [];
  const hasContent = tokenList.length > 0 || entryList.length > 0;

  if (!hasContent) {
    if (emptyText) {
      return (
        <p className="text-sm text-[var(--color-light-text)] italic">
          {emptyText}
        </p>
      );
    }
    return null;
  }

  const resolvePrefix = (token: string): ReactNode => {
    if (!prefix) return null;
    return typeof prefix === "function" ? prefix(token) : prefix;
  };

  const renderValue = (value: string | number): ReactNode => {
    if (formatValue) return formatValue(value);
    return typeof value === "number" ? value.toLocaleString() : String(value);
  };

  const containerClass = mode === "row"
    ? `flex flex-wrap gap-1.5${className ? ` ${className}` : ""}`
    : `space-y-1${className ? ` ${className}` : ""}`;

  return (
    <div>
      {title && (
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-light-text)] mb-1">
          {title}
        </p>
      )}
      <div className={containerClass}>
        {leading}
        {tokenList.map((token) =>
          mode === "column"
            ? (
              <div key={token} className="flex items-center gap-2">
                {resolvePrefix(token)}
                <TranslatedBadge
                  kind={kind}
                  token={token}
                  systemSlug={systemSlug}
                  frameworkName={frameworkName}
                  compact={compact}
                />
              </div>
            )
            : (
              <TranslatedBadge
                key={token}
                kind={kind}
                token={token}
                systemSlug={systemSlug}
                frameworkName={frameworkName}
                compact={compact}
              />
            )
        )}
        {entryList.map(([key, val]) =>
          mode === "column"
            ? (
              <div
                key={key}
                className={`flex items-center gap-2${
                  justifyValues ? " justify-between" : ""
                }`}
              >
                <span className="flex items-center gap-1">
                  {resolvePrefix(key)}
                  <TranslatedBadge
                    kind={kind}
                    token={key}
                    systemSlug={systemSlug}
                    frameworkName={frameworkName}
                    compact={compact}
                  />
                </span>
                {justifyValues
                  ? <span className="text-white">{renderValue(val)}</span>
                  : <span>: {renderValue(val)}</span>}
              </div>
            )
            : (
              <span key={key} className="inline-flex items-center gap-1">
                {resolvePrefix(key)}
                <TranslatedBadge
                  kind={kind}
                  token={key}
                  systemSlug={systemSlug}
                  frameworkName={frameworkName}
                  compact={compact}
                />
                <span className="text-xs text-[var(--color-light-text)]">
                  : {renderValue(val)}
                </span>
              </span>
            )
        )}
      </div>
    </div>
  );
}
