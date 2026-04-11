"use client";

import { useState } from "react";
import type { MenuItem } from "@/src/contracts/menu";
import { useLocale } from "@/src/hooks/useLocale";

interface SidebarMenuItemProps {
  item: MenuItem;
  depth?: number;
  searchQuery?: string;
  activeComponent?: string;
  onNavigate: (componentName: string) => void;
}

function countLeaves(item: MenuItem): number {
  if (!item.children?.length) return 0;
  return item.children.reduce(
    (sum, child) => sum + 1 + countLeaves(child),
    0,
  );
}

export default function SidebarMenuItem(
  { item, depth = 0, searchQuery, activeComponent, onNavigate }:
    SidebarMenuItemProps,
) {
  const { t } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const hasChildren = item.children && item.children.length > 0;
  const label = t(item.label) !== item.label ? t(item.label) : item.label;
  const isActive = !hasChildren && item.componentName === activeComponent;
  const childCount = hasChildren ? countLeaves(item) : 0;

  const matchesSearch = !searchQuery ||
    label.toLowerCase().includes(searchQuery.toLowerCase());
  const childMatchesDeep = (children: MenuItem[] | undefined): boolean => {
    if (!children) return false;
    return children.some((child) => {
      const childLabel = t(child.label);
      if (
        childLabel.toLowerCase().includes((searchQuery ?? "").toLowerCase())
      ) {
        return true;
      }
      return childMatchesDeep(child.children);
    });
  };
  const childMatches = childMatchesDeep(item.children);

  if (searchQuery && !matchesSearch && !childMatches) return null;

  const isExpanded = expanded || (!!searchQuery && !!childMatches);

  // --- Root-level item (depth === 0) ---
  if (depth === 0) {
    return (
      <div className="relative">
        {/* Active item: outer glow */}
        {isActive && (
          <div className="absolute -inset-px rounded-2xl bg-gradient-to-r from-[var(--color-primary-green)]/20 to-[var(--color-secondary-blue)]/15 blur-sm pointer-events-none" />
        )}

        <button
          onClick={() => {
            if (hasChildren) {
              setExpanded(!expanded);
            } else {
              onNavigate(item.componentName);
            }
          }}
          className={`group/item relative w-full flex items-center gap-3 rounded-2xl text-sm transition-all duration-300 px-3.5 py-3 ${
            isActive
              ? "bg-gradient-to-r from-[var(--color-primary-green)]/[0.12] via-white/[0.04] to-[var(--color-secondary-blue)]/[0.08] text-white ring-1 ring-[var(--color-primary-green)]/25 shadow-[0_0_20px_rgba(2,208,125,0.08)]"
              : hasChildren
              ? "text-white/50 hover:text-white/90 hover:bg-white/[0.04]"
              : "text-white/70 hover:text-white hover:bg-white/[0.06] hover:ring-1 hover:ring-white/[0.06]"
          }`}
        >
          {/* Active indicator — left accent bar */}
          {isActive && (
            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 rounded-r-full bg-gradient-to-b from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] shadow-[0_0_8px_rgba(2,208,125,0.5)]" />
          )}

          {/* Emoji container with background pill */}
          {item.emoji && (
            <span
              className={`relative flex items-center justify-center w-8 h-8 rounded-xl text-base shrink-0 transition-all duration-300 ${
                isActive
                  ? "bg-[var(--color-primary-green)]/15 shadow-[0_0_12px_rgba(2,208,125,0.2)] scale-110"
                  : hasChildren
                  ? "bg-white/[0.04] group-hover/item:bg-white/[0.08]"
                  : "bg-white/[0.04] group-hover/item:bg-[var(--color-primary-green)]/10 group-hover/item:scale-105"
              }`}
            >
              {item.emoji}
            </span>
          )}

          {/* Label */}
          <span
            className={`flex-1 text-left truncate transition-all duration-200 ${
              isActive ? "font-semibold" : "font-medium"
            }`}
          >
            {label}
          </span>

          {/* Child count badge for expandable groups */}
          {hasChildren && (
            <span className="flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-white/[0.06] text-[10px] font-medium text-white/40 group-hover/item:text-white/60 transition-colors">
              {childCount}
            </span>
          )}

          {/* Expand/collapse chevron */}
          {hasChildren && (
            <span
              className={`text-[10px] text-white/30 group-hover/item:text-white/50 transition-all duration-300 ${
                isExpanded ? "rotate-180" : "rotate-0"
              }`}
            >
              ▾
            </span>
          )}

          {/* Hover shine sweep (leaf items only) */}
          {!hasChildren && !isActive && (
            <div className="absolute inset-0 rounded-2xl opacity-0 group-hover/item:opacity-100 transition-opacity duration-700 bg-gradient-to-r from-transparent via-white/[0.03] to-transparent pointer-events-none" />
          )}
        </button>

        {/* Children container */}
        {hasChildren && isExpanded && (
          <div
            className="mt-1 ml-4 relative"
            style={{ animation: "fadeSlideIn 250ms ease-out" }}
          >
            {/* Vertical tree line */}
            <div className="absolute left-2 top-1 bottom-1 w-px bg-gradient-to-b from-[var(--color-primary-green)]/20 via-white/[0.07] to-transparent" />

            <div className="space-y-0.5 py-0.5">
              {item.children!.map((child) => (
                <SidebarMenuItem
                  key={child.id}
                  item={child}
                  depth={depth + 1}
                  searchQuery={searchQuery}
                  activeComponent={activeComponent}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // --- Nested item (depth > 0) ---
  return (
    <div className="relative">
      {/* Horizontal branch connector from vertical line */}
      <div className="absolute left-2 top-1/2 w-4 h-px bg-white/[0.07]" />

      {/* Active nested: tiny dot on the tree line */}
      {isActive && (
        <div className="absolute left-[6px] top-1/2 -translate-y-1/2 w-[5px] h-[5px] rounded-full bg-[var(--color-primary-green)] shadow-[0_0_6px_rgba(2,208,125,0.6)] z-10" />
      )}

      <button
        onClick={() => {
          if (hasChildren) {
            setExpanded(!expanded);
          } else {
            onNavigate(item.componentName);
          }
        }}
        className={`group/nested relative w-full flex items-center gap-2.5 rounded-xl text-[13px] transition-all duration-250 pl-8 pr-3 py-2 ${
          isActive
            ? "bg-[var(--color-primary-green)]/[0.08] text-white font-medium ring-1 ring-[var(--color-primary-green)]/15"
            : hasChildren
            ? "text-white/40 hover:text-white/70 hover:bg-white/[0.03]"
            : "text-white/55 hover:text-white hover:bg-white/[0.05]"
        }`}
      >
        {/* Emoji (smaller for nested) */}
        {item.emoji && (
          <span
            className={`text-sm shrink-0 transition-all duration-200 ${
              isActive
                ? "drop-shadow-[0_0_4px_rgba(2,208,125,0.4)]"
                : "opacity-70 group-hover/nested:opacity-100"
            }`}
          >
            {item.emoji}
          </span>
        )}

        {/* Dot indicator when no emoji */}
        {!item.emoji && (
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 transition-all duration-200 ${
              isActive
                ? "bg-[var(--color-primary-green)] shadow-[0_0_4px_rgba(2,208,125,0.5)]"
                : "bg-white/20 group-hover/nested:bg-white/40"
            }`}
          />
        )}

        <span className="flex-1 text-left truncate">
          {label}
        </span>

        {/* Nested group badge + chevron */}
        {hasChildren && (
          <>
            <span className="flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-white/[0.05] text-[9px] font-medium text-white/30">
              {childCount}
            </span>
            <span
              className={`text-[9px] text-white/25 transition-transform duration-300 ${
                isExpanded ? "rotate-180" : "rotate-0"
              }`}
            >
              ▾
            </span>
          </>
        )}
      </button>

      {/* Deeper children */}
      {hasChildren && isExpanded && (
        <div
          className="mt-0.5 ml-4 relative"
          style={{ animation: "fadeSlideIn 250ms ease-out" }}
        >
          {/* Continuation tree line */}
          <div className="absolute left-2 top-1 bottom-1 w-px bg-gradient-to-b from-white/[0.06] via-white/[0.04] to-transparent" />

          <div className="space-y-0.5 py-0.5">
            {item.children!.map((child) => (
              <SidebarMenuItem
                key={child.id}
                item={child}
                depth={depth + 1}
                searchQuery={searchQuery}
                activeComponent={activeComponent}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
