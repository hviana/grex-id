"use client";

import { useEffect, useRef, useState } from "react";
import type { MenuItem } from "@/src/contracts/menu";
import { useDebounce } from "@/src/hooks/useDebounce";
import { useLocale } from "@/src/hooks/useLocale";
import SidebarSearch from "./SidebarSearch.tsx";
import SidebarMenuItem from "./SidebarMenuItem.tsx";
import Spinner from "./Spinner.tsx";

interface SidebarProps {
  menus: MenuItem[];
  systemLogo?: string;
  systemName?: string;
  activeComponent?: string;
  onNavigate: (componentName: string) => void;
}

/**
 * Finds the section label (the parent group emoji + label) for
 * the current active component so we can display a breadcrumb-like indicator.
 */
function findActiveSection(
  menus: MenuItem[],
  activeComponent: string | undefined,
  t: (key: string) => string,
): { emoji?: string; label: string } | null {
  if (!activeComponent) return null;
  for (const item of menus) {
    if (!item.children?.length && item.componentName === activeComponent) {
      return null; // top-level item, no section
    }
    if (item.children?.length) {
      const found = findInChildren(item.children, activeComponent);
      if (found) {
        const label = t(item.label) !== item.label ? t(item.label) : item.label;
        return { emoji: item.emoji, label };
      }
    }
  }
  return null;
}

function findInChildren(
  items: MenuItem[],
  componentName: string,
): boolean {
  return items.some((child) => {
    if (child.componentName === componentName) return true;
    return child.children?.length
      ? findInChildren(child.children, componentName)
      : false;
  });
}

export default function Sidebar(
  { menus, systemLogo, systemName, activeComponent, onNavigate }: SidebarProps,
) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 200);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const { t } = useLocale();

  const activeSection = findActiveSection(menus, activeComponent, t);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        open && sidebarRef.current &&
        !sidebarRef.current.contains(e.target as Node) &&
        !toggleRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleNavigate = (componentName: string) => {
    onNavigate(componentName);
    setOpen(false);
  };

  return (
    <>
      {/* Mobile toggle — floating button with gradient ring */}
      <button
        ref={toggleRef}
        onClick={() => setOpen(!open)}
        className="fixed top-4 left-4 z-50 lg:hidden"
      >
        <div className="relative flex items-center justify-center w-11 h-11">
          {/* Gradient ring */}
          <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-[var(--color-primary-green)]/40 to-[var(--color-secondary-blue)]/40 p-px">
            <div className="w-full h-full rounded-2xl bg-[#0a0a0a]" />
          </div>
          <span
            className={`relative text-white text-lg transition-all duration-300 ${
              open ? "rotate-90 scale-110" : ""
            }`}
          >
            {open ? "✕" : "☰"}
          </span>
        </div>
      </button>

      {/* Overlay with blur */}
      {open && (
        <div className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden" />
      )}

      {/* Sidebar */}
      <div
        ref={sidebarRef}
        className={`fixed top-0 left-0 z-40 h-full w-[280px] flex flex-col transition-transform duration-300 ease-out ${
          open ? "translate-x-0" : "-translate-x-full"
        } lg:translate-x-0 lg:relative lg:z-auto`}
      >
        {/* ── Background layers ── */}
        {/* Base gradient */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#0e0e0e] via-[#0a0a0a] to-[#070707]" />

        {/* Right border — gradient line with a bright midpoint */}
        <div className="absolute top-0 right-0 bottom-0 w-px bg-gradient-to-b from-transparent via-[var(--color-primary-green)]/15 to-transparent" />

        {/* Top ambient glow — green tinted */}
        <div className="absolute top-0 left-0 right-0 h-40 bg-gradient-to-b from-[var(--color-primary-green)]/[0.04] to-transparent pointer-events-none" />

        {/* Bottom ambient glow — blue tinted */}
        <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-[var(--color-secondary-blue)]/[0.02] to-transparent pointer-events-none" />

        {/* Corner radial highlights */}
        <div className="absolute top-0 left-0 w-40 h-40 bg-[radial-gradient(circle_at_top_left,rgba(2,208,125,0.05),transparent_70%)] pointer-events-none" />

        {/* ── Content ── */}
        <div className="relative flex flex-col h-full">
          {/* ── System branding ── */}
          <div className="px-5 pt-6 pb-5">
            <div className="flex items-center gap-3.5">
              {systemLogo
                ? (
                  <div className="relative shrink-0 group/logo">
                    {/* Logo glow */}
                    <div className="absolute -inset-1 rounded-2xl bg-gradient-to-br from-[var(--color-primary-green)]/20 to-[var(--color-secondary-blue)]/15 blur-md opacity-60 group-hover/logo:opacity-100 transition-opacity duration-500" />
                    {/* Gradient border for logo */}
                    <div className="relative rounded-2xl p-px bg-gradient-to-br from-[var(--color-primary-green)]/40 to-[var(--color-secondary-blue)]/30">
                      <img
                        src={systemLogo}
                        alt={systemName}
                        className="w-10 h-10 rounded-[15px] object-cover bg-[#111]"
                      />
                    </div>
                  </div>
                )
                : !systemName
                ? <Spinner size="sm" />
                : null}

              <div className="min-w-0 flex-1">
                <h1 className="text-lg font-bold bg-gradient-to-r from-[var(--color-primary-green)] via-[var(--color-light-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent truncate leading-tight bg-[length:200%_100%]">
                  {systemName ?? ""}
                </h1>
                {/* Active section breadcrumb */}
                {activeSection && (
                  <p className="text-[11px] text-white/30 truncate mt-0.5">
                    {activeSection.emoji && (
                      <span className="mr-1">{activeSection.emoji}</span>
                    )}
                    {activeSection.label}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* ── Decorative separator with gradient ── */}
          <div className="px-5 pb-4">
            <div className="relative h-px">
              <div className="absolute inset-0 bg-gradient-to-r from-[var(--color-primary-green)]/25 via-[var(--color-secondary-blue)]/15 to-transparent" />
              {/* Bright dot accent on the line */}
              <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-[var(--color-primary-green)]/60 shadow-[0_0_6px_rgba(2,208,125,0.4)]" />
            </div>
          </div>

          {/* ── Search ── */}
          <div className="px-4 pb-4">
            <SidebarSearch value={search} onChange={setSearch} />
          </div>

          {/* ── Navigation label ── */}
          <div className="px-5 pb-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/20">
              {t("common.sidebar.navigation")}
            </span>
          </div>

          {/* ── Menu items ── */}
          <nav className="flex-1 overflow-y-auto px-3 pb-6 space-y-1 minimal-scrollbar">
            {menus.length === 0
              ? (
                <div className="flex items-center justify-center py-12">
                  <Spinner size="sm" />
                </div>
              )
              : menus.map((item) => (
                <SidebarMenuItem
                  key={item.id}
                  item={item}
                  searchQuery={debouncedSearch}
                  activeComponent={activeComponent}
                  onNavigate={handleNavigate}
                />
              ))}
          </nav>

          {/* ── Footer ── */}
          <div className="px-5 pb-5 pt-2">
            {/* Separator */}
            <div className="relative h-px mb-4">
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
            </div>

            {/* Decorative footer bar */}
            <div className="flex items-center justify-center gap-2">
              <div className="h-[3px] w-6 rounded-full bg-gradient-to-r from-[var(--color-primary-green)]/30 to-[var(--color-primary-green)]/10" />
              <div className="h-[3px] w-3 rounded-full bg-[var(--color-secondary-blue)]/20" />
              <div className="h-[3px] w-1.5 rounded-full bg-white/10" />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
