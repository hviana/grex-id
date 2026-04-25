"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/src/hooks/useAuth";
import { useLocale } from "@/src/hooks/useLocale";
import { useSystemContext } from "@/src/hooks/useSystemContext";
import { useRouter } from "next/navigation";
import SearchableSelectField from "@/src/components/fields/SearchableSelectField";

export default function ProfileMenu() {
  const { user, logout } = useAuth();
  const { t } = useLocale();
  const router = useRouter();
  const {
    companyId,
    systemId,
    companies,
    systems,
    switchCompany,
    switchSystem,
  } = useSystemContext();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const activeCompany = companies.find((c) => c.id === companyId);
  const activeSystem = systems.find((s) => s.id === systemId);

  const fetchCompanies = useCallback(
    async (search: string) => {
      const lower = search.toLowerCase();
      return companies
        .filter((c) => !lower || c.name.toLowerCase().includes(lower))
        .map((c) => ({ id: c.id, label: c.name }));
    },
    [companies],
  );

  const fetchSystems = useCallback(
    async (search: string) => {
      const lower = search.toLowerCase();
      return systems
        .filter((s) => !lower || s.name.toLowerCase().includes(lower))
        .map((s) => ({ id: s.id, label: s.name }));
    },
    [systems],
  );

  const handleCompanyChange = useCallback(
    (selected: { id: string; label: string }[]) => {
      const sel = selected[0];
      if (sel && sel.id !== companyId) {
        switchCompany(sel.id);
        router.push("/entry");
      }
    },
    [companyId, switchCompany, router],
  );

  const handleSystemChange = useCallback(
    (selected: { id: string; label: string }[]) => {
      const sel = selected[0];
      if (sel && sel.id !== systemId) {
        switchSystem(sel.id);
        router.push("/entry");
      }
    },
    [systemId, switchSystem, router],
  );

  const handleClose = () => {
    setOpen(false);
  };

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-white/5 transition-colors"
      >
        <div className="w-8 h-8 rounded-full bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] flex items-center justify-center text-sm font-bold text-black">
          {user?.profileId?.name?.[0]?.toUpperCase() ?? "?"}
        </div>
        <div className="hidden sm:flex flex-col items-start">
          <span className="text-sm text-white truncate max-w-32">
            {user?.profileId?.name ?? t("common.user")}
          </span>
          {activeCompany && (
            <span className="text-xs text-[var(--color-light-text)] truncate max-w-32">
              {activeCompany.name}
            </span>
          )}
        </div>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 z-50 backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl shadow-lg overflow-hidden">
          {/* Company selector */}
          {companies.length > 0 && (
            <div className="border-b border-[var(--color-dark-gray)] p-3">
              <div className="pb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-light-text)]">
                🏢 {t("common.profile.company")}
              </div>
              <SearchableSelectField
                fetchFn={fetchCompanies}
                multiple={false}
                showAllOnEmpty
                onChange={handleCompanyChange}
                initialSelected={activeCompany
                  ? [{ id: activeCompany.id, label: activeCompany.name }]
                  : []}
                placeholder={t("common.profile.switchCompany")}
              />
            </div>
          )}

          {/* System selector */}
          {companies.length > 0 && (
            <div className="border-b border-[var(--color-dark-gray)] p-3">
              <div className="pb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-light-text)]">
                🔌 {t("common.profile.system")}
              </div>
              {systems.length === 0
                ? (
                  <p className="text-xs text-[var(--color-light-text)]">
                    {t("common.profile.noSystems")}
                  </p>
                )
                : (
                  <SearchableSelectField
                    fetchFn={fetchSystems}
                    multiple={false}
                    showAllOnEmpty
                    onChange={handleSystemChange}
                    initialSelected={activeSystem
                      ? [{ id: activeSystem.id, label: activeSystem.name }]
                      : []}
                    placeholder={t("common.profile.switchSystem")}
                  />
                )}
            </div>
          )}

          {/* Profile */}
          <button
            onClick={() => {
              handleClose();
              router.push("/profile");
            }}
            className="w-full text-left px-4 py-3 text-sm text-[var(--color-light-text)] hover:bg-white/5 hover:text-white transition-colors"
          >
            👤 {t("common.profile.menu")}
          </button>

          {/* Logout */}
          <button
            onClick={() => {
              const slug = activeSystem?.slug;
              handleClose();
              logout();
              router.push(
                slug
                  ? `/login?systemSlug=${encodeURIComponent(slug)}`
                  : "/login",
              );
            }}
            className="w-full text-left px-4 py-3 text-sm text-red-400 hover:bg-white/5 transition-colors border-t border-[var(--color-dark-gray)]"
          >
            🚪 {t("common.profile.logout")}
          </button>
        </div>
      )}
    </div>
  );
}
