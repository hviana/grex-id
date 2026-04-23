"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/src/hooks/useLocale";
import { useAuth } from "@/src/hooks/useAuth";
import Spinner from "@/src/components/shared/Spinner";
import MenuTreeEditor from "@/src/components/core/MenuTreeEditor";

interface SystemOption {
  id: string;
  slug: string;
  name: string;
}

export default function MenusPage() {
  const { t } = useLocale();
  const { systemToken } = useAuth();
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
          const data = json.data ?? [];
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

  const inputCls =
    "w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-2.5 text-white outline-none focus:border-[var(--color-primary-green)] transition-colors";

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
              <select
                value={selectedSystemId}
                onChange={(e) => setSelectedSystemId(e.target.value)}
                className={inputCls}
              >
                <option value="" disabled>
                  {t("core.menus.selectSystem")}
                </option>
                {systems.map((sys) => (
                  <option key={sys.id} value={sys.id}>
                    {sys.name}
                  </option>
                ))}
              </select>
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
