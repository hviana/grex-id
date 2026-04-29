"use client";

import { useCallback, useEffect, useState } from "react";
import Spinner from "@/src/components/shared/Spinner";
import MenuTreeEditor from "@/src/components/core/MenuTreeEditor";
import SearchableSelectField from "@/src/components/fields/SearchableSelectField";
import { useTenantContext } from "@/src/hooks/useTenantContext";
import type { SystemOption } from "@/src/contracts/high_level/components";

export default function MenusPage() {
  const { t } = useTenantContext();
  const { systemToken } = useTenantContext();
  const [systems, setSystems] = useState<SystemOption[]>([]);
  const [selectedSystemId, setSelectedSystemId] = useState("");
  const [loadingSystems, setLoadingSystems] = useState(true);

  useEffect(() => {
    if (!systemToken) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/core/systems?limit=200", {
          headers: { Authorization: `Bearer ${systemToken}` },
        });
        const json = await res.json();
        if (json.success && !cancelled) {
          const data = json.items ?? [];
          setSystems(data);
          if (data.length > 0) setSelectedSystemId(data[0].id);
        }
      } finally {
        if (!cancelled) setLoadingSystems(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [systemToken]);

  const systemFetchFn = useCallback(
    async (search: string) => {
      const q = search.toLowerCase();
      return systems
        .filter((s) =>
          !q || s.name.toLowerCase().includes(q) ||
          s.slug.toLowerCase().includes(q)
        )
        .map((s) => ({ id: s.id, label: s.name }));
    },
    [systems],
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent">
        {t("core.menus.title")}
      </h1>

      {loadingSystems
        ? (
          <div className="flex justify-center py-12">
            <Spinner size="lg" />
          </div>
        )
        : systems.length === 0
        ? (
          <p className="text-center py-12 text-[var(--color-light-text)]">
            {t("core.menus.empty")}
          </p>
        )
        : (
          <>
            <div className="max-w-xs">
              <SearchableSelectField
                key={selectedSystemId}
                fetchFn={systemFetchFn}
                showAllOnEmpty
                initialSelected={selectedSystemId
                  ? [{
                    id: selectedSystemId,
                    label: systems.find((s) => s.id === selectedSystemId)
                      ?.name ?? "",
                  }]
                  : []}
                onChange={(items) => {
                  setSelectedSystemId(
                    items.length > 0 ? items[0].id : "",
                  );
                }}
                placeholder={t("core.menus.selectSystem")}
              />
            </div>

            {selectedSystemId && (
              <MenuTreeEditor
                key={selectedSystemId}
                systemId={selectedSystemId}
                systemSlug={systems.find((s) => s.id === selectedSystemId)
                  ?.slug}
              />
            )}
          </>
        )}
    </div>
  );
}
