"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Spinner from "@/src/components/shared/Spinner";
import ErrorDisplay from "@/src/components/shared/ErrorDisplay";
import DateRangeFilter from "@/src/components/filters/DateRangeFilter";
import MultiBadgeField from "@/src/components/fields/MultiBadgeField";
import SearchableSelectField from "@/src/components/fields/SearchableSelectField";
import type { BadgeValue } from "@/src/contracts/high-level/components";
import { Bar } from "react-chartjs-2";
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Title,
  Tooltip,
} from "chart.js";
import type { TooltipItem } from "chart.js";
import type { UsageData } from "@/src/contracts/high-level/usage";
import type { CoreCreditExpenseRow } from "@/src/contracts/high-level/query-results";
import type { UsageTenantFilter } from "@/src/contracts/high-level/usage";
import { useTenantContext } from "@/src/hooks/useTenantContext";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
);

import type { UsagePageProps } from "@/src/contracts/high-level/component-props";

interface TenantEntry {
  id: string;
  systemId: string;
  companyId: string;
  actors: BadgeValue[];
}

function extractIds(badges: BadgeValue[]): string[] {
  return badges.map((b) => (typeof b === "string" ? b : b.id ?? b.name));
}

export default function UsagePage({ mode }: UsagePageProps) {
  const { t, systemToken, roles } = useTenantContext();
  const isCore = mode === "core" || roles.includes("superuser");

  const tenant = useTenantContext();
  const companyId = isCore ? undefined : tenant.companyId;
  const systemId = isCore ? undefined : tenant.systemId;
  const tenantSystemSlug = isCore ? undefined : tenant.systemSlug ?? undefined;

  function resourceLabel(token: string): string {
    if (tenantSystemSlug) {
      const key = `systems.${tenantSystemSlug}.resources.${token}`;
      const v = t(key);
      if (v !== key) return v;
    }
    const coreKey = `resources.${token}`;
    const v2 = t(coreKey);
    if (v2 !== coreKey) return v2;
    return token;
  }

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<UsageData | null>(null);

  const [startDate, setStartDate] = useState(() =>
    new Date(Date.now() - 31 * 86400000).toISOString().slice(0, 10)
  );
  const [endDate, setEndDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );

  // Tenant mode: actor filter
  const [actorFilter, setActorFilter] = useState<BadgeValue[]>([]);

  // Core mode: dynamic tenant entries
  const [tenantEntries, setTenantEntries] = useState<TenantEntry[]>([]);

  const cancelledRef = useRef(false);

  const loadData = useCallback(async () => {
    if (!systemToken) return;
    cancelledRef.current = false;
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ startDate, endDate });

      if (isCore) {
        params.set("mode", "core");
        const filters: UsageTenantFilter[] = tenantEntries
          .filter((e) => e.systemId && e.companyId)
          .map((e) => ({
            systemId: e.systemId,
            companyId: e.companyId,
            actorIds: extractIds(e.actors).length > 0
              ? extractIds(e.actors)
              : undefined,
          }));
        if (filters.length > 0) {
          params.set("tenants", JSON.stringify(filters));
        }
      } else {
        const actorIds = extractIds(actorFilter);
        if (actorIds.length > 0) {
          params.set("actors", actorIds.join(","));
        }
      }

      const res = await fetch(`/api/usage?${params}`, {
        headers: { Authorization: `Bearer ${systemToken}` },
      });
      const json = await res.json();
      if (!cancelledRef.current) {
        if (json.success) {
          setData(json.data);
        } else {
          setError(json.error?.message ?? "common.error.generic");
        }
      }
    } catch {
      if (!cancelledRef.current) setError("common.error.network");
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  }, [
    systemToken,
    startDate,
    endDate,
    isCore,
    tenantEntries,
    actorFilter,
  ]);

  useEffect(() => {
    loadData();
    return () => {
      cancelledRef.current = true;
    };
  }, [loadData]);

  const formatBytes = (bytes: number) => {
    if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(2)} GB`;
    if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${bytes} B`;
  };

  // ── Fetch helpers ──

  const fetchCompanies = useCallback(
    async (search: string): Promise<{ id: string; label: string }[]> => {
      if (!systemToken) return [];
      const res = await fetch(
        `/api/core/companies?search=${encodeURIComponent(search)}&limit=20`,
        { headers: { Authorization: `Bearer ${systemToken}` } },
      );
      const json = await res.json();
      return (json.items ?? []).map((c: { id: string; name: string }) => ({
        id: c.id,
        label: c.name,
      }));
    },
    [systemToken],
  );

  const fetchSystems = useCallback(
    async (search: string): Promise<{ id: string; label: string }[]> => {
      if (!systemToken) return [];
      const res = await fetch(
        `/api/core/systems?search=${encodeURIComponent(search)}&limit=20`,
        { headers: { Authorization: `Bearer ${systemToken}` } },
      );
      const json = await res.json();
      return (json.items ?? []).map((s: { id: string; name: string }) => ({
        id: s.id,
        label: s.name,
      }));
    },
    [systemToken],
  );

  const fetchActors = useCallback(
    async (
      search: string,
      filterCompanyId?: string,
      filterSystemId?: string,
    ): Promise<BadgeValue[]> => {
      if (!systemToken) return [];
      const params = new URLSearchParams({
        search,
        limit: "20",
      });
      if (filterCompanyId) params.set("companyId", filterCompanyId);
      if (filterSystemId) params.set("systemId", filterSystemId);
      const res = await fetch(`/api/users?${params}`, {
        headers: { Authorization: `Bearer ${systemToken}` },
      });
      const json = await res.json();
      return (
        (json.items ?? []) as { id: string; name?: string; email: string }[]
      ).map((u) => ({ name: u.name ?? u.email, id: u.id }));
    },
    [systemToken],
  );

  // Tenant-mode actor fetch
  const fetchTenantActors = useCallback(
    async (search: string): Promise<BadgeValue[]> =>
      fetchActors(search, companyId ?? undefined, systemId ?? undefined),
    [fetchActors, companyId, systemId],
  );

  // ── Core mode: tenant entry management ──

  const addTenantEntry = () => {
    setTenantEntries((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        systemId: "",
        companyId: "",
        actors: [],
      },
    ]);
  };

  const removeTenantEntry = (id: string) => {
    setTenantEntries((prev) => prev.filter((e) => e.id !== id));
  };

  const updateTenantEntry = (
    id: string,
    updates: Partial<TenantEntry>,
  ) => {
    setTenantEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, ...updates } : e))
    );
  };

  // ── Chart data ──

  const expenses: CoreCreditExpenseRow[] = data?.creditExpenses ?? [];
  const totalSpending = expenses.reduce((sum, e) => sum + e.totalAmount, 0);

  const chartData = expenses.length > 0
    ? {
      labels: expenses.map((e) => resourceLabel(e.resourceKey)),
      datasets: [
        {
          label: t("core.usage.chart.amount"),
          data: expenses.map((e) => e.totalAmount / 100),
          backgroundColor: "rgba(2, 208, 125, 0.7)",
          borderColor: "#02d07d",
          borderWidth: 1,
          borderRadius: 6,
          yAxisID: "y",
        },
        {
          label: t("core.usage.chart.count"),
          data: expenses.map((e) => e.totalCount),
          backgroundColor: "rgba(0, 204, 255, 0.7)",
          borderColor: "#00ccff",
          borderWidth: 1,
          borderRadius: 6,
          yAxisID: "y1",
        },
      ],
    }
    : null;

  // ── Summary table ──

  function renderSummaryTable(rows: CoreCreditExpenseRow[]) {
    return (
      <div className="border-t border-[var(--color-dark-gray)] pt-4">
        <h3 className="text-sm font-semibold text-white mb-2">
          {t("billing.usage.totalExpenses")}
        </h3>
        <div className="space-y-2">
          {rows.map((e, i) => {
            const label = resourceLabel(e.resourceKey);
            const avgCost = e.totalCount > 0
              ? ((e.totalAmount / e.totalCount) / 100).toFixed(
                isCore ? 4 : 2,
              )
              : "0.00";
            return (
              <div
                key={e.resourceKey}
                className="flex items-center justify-between text-sm gap-4"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="w-3 h-3 rounded-full inline-block shrink-0"
                    style={{
                      backgroundColor: i % 2 === 0 ? "#02d07d" : "#00ccff",
                    }}
                  />
                  <span className="text-[var(--color-light-text)] truncate">
                    {label}
                  </span>
                </div>
                <div className="flex items-center gap-3 shrink-0 text-right">
                  <span
                    className="text-[var(--color-light-text)] text-xs"
                    title={t("billing.usage.count")}
                  >
                    {e.totalCount}x
                  </span>
                  <span
                    className="text-[var(--color-light-text)] text-xs"
                    title={t("billing.usage.avgCost")}
                  >
                    ~{avgCost}
                  </span>
                  <span className="text-white font-medium">
                    {(e.totalAmount / 100).toFixed(2)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Chart options (shared) ──

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: "#cccccc" } },
      tooltip: {
        callbacks: {
          label: (ctx: TooltipItem<"bar">) => {
            const raw = typeof ctx.raw === "number" ? ctx.raw : Number(ctx.raw);
            if (ctx.datasetIndex === 0) {
              return `${ctx.dataset.label}: ${raw.toFixed(2)}`;
            }
            return `${ctx.dataset.label}: ${raw}`;
          },
        },
      },
    },
    scales: {
      x: {
        ticks: { color: "#cccccc", font: { size: 11 } },
        grid: { color: "rgba(51,51,51,0.3)" },
      },
      y: {
        position: "left" as const,
        title: {
          display: true,
          text: t("core.usage.chart.amount"),
          color: "#cccccc",
        },
        ticks: { color: "#cccccc" },
        grid: { color: "rgba(51,51,51,0.3)" },
      },
      y1: {
        position: "right" as const,
        title: {
          display: true,
          text: t("core.usage.chart.count"),
          color: "#cccccc",
        },
        ticks: { color: "#cccccc" },
        grid: { drawOnChartArea: false },
      },
    },
  };

  // ── Render ──

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent">
        {isCore ? t("core.usage.title") : t("billing.usage.title")}
      </h1>

      <ErrorDisplay message={error} />

      {/* ── Date range (both modes) ── */}
      <div className="flex items-center justify-end">
        <DateRangeFilter
          maxRangeDays={31}
          onChange={(s, e) => {
            setStartDate(s.toISOString().slice(0, 10));
            setEndDate(e.toISOString().slice(0, 10));
          }}
        />
      </div>

      {/* ── Tenant mode: actor filter + storage ── */}
      {!isCore && (
        <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-6 space-y-4">
          <MultiBadgeField
            name={t("core.usage.actors")}
            mode="search"
            value={actorFilter}
            onChange={setActorFilter}
            fetchFn={fetchTenantActors}
          />

          {data?.tenants?.map((tr) => {
            const pct = tr.storage.limitBytes > 0
              ? Math.min(
                100,
                (tr.storage.usedBytes / tr.storage.limitBytes) * 100,
              )
              : 0;
            const actorLabel = tr.actorId
              ? ` — ${
                (() => {
                  const found = actorFilter.find((a) =>
                    (typeof a === "string" ? a : a.id) === tr.actorId
                  );
                  return found && typeof found !== "string"
                    ? found.name
                    : tr.actorId;
                })()
              }`
              : "";
            return (
              <div
                key={`${tr.companyId}-${tr.systemId}${
                  tr.actorId ? `-${tr.actorId}` : ""
                }`}
              >
                <h2 className="text-lg font-semibold text-white mb-3">
                  💾 {t("billing.usage.storage")}
                  {actorLabel}
                </h2>
                <div className="flex items-center gap-4 mb-3">
                  <p className="text-2xl font-bold text-[var(--color-primary-green)]">
                    {formatBytes(tr.storage.usedBytes)}
                  </p>
                  <span className="text-[var(--color-light-text)]">/</span>
                  <p className="text-lg text-[var(--color-light-text)]">
                    {tr.storage.limitBytes > 0
                      ? formatBytes(tr.storage.limitBytes)
                      : t("billing.limits.unlimited")}
                  </p>
                </div>
                {tr.storage.limitBytes > 0 && (
                  <div className="w-full h-4 bg-[var(--color-dark-gray)] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] transition-all duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                )}

                {/* Subscription info */}
                {tr.subscription && (
                  <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="text-sm">
                      <span className="text-[var(--color-light-text)]">
                        {t("billing.credits.balance")}:
                      </span>{" "}
                      <span className="text-white font-medium">
                        {(
                          tr.subscription.remainingPlanCredits +
                          tr.subscription.purchasedCredits
                        ).toFixed(2)}
                      </span>
                    </div>
                    {tr.subscription.remainingOperationCount &&
                      Object.keys(tr.subscription.remainingOperationCount)
                          .length > 0 &&
                      (
                        <div className="text-sm space-y-1">
                          <span className="text-[var(--color-light-text)]">
                            {t(
                              "billing.limits.maxOperationCountByResourceKey",
                            )}:
                          </span>
                          {Object.entries(
                            tr.subscription.remainingOperationCount,
                          ).map(([key, val]) => (
                            <div key={key} className="flex justify-between">
                              <span className="text-[var(--color-light-text)]">
                                {resourceLabel(key)}
                              </span>
                              <span className="text-white">{val}</span>
                            </div>
                          ))}
                        </div>
                      )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Core mode: dynamic tenant entries ── */}
      {isCore && (
        <div className="space-y-4">
          {tenantEntries.map((entry) => (
            <div
              key={entry.id}
              className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-6 space-y-4"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white">
                  {t("core.usage.addTenant")}
                </h3>
                <button
                  type="button"
                  onClick={() => removeTenantEntry(entry.id)}
                  className="text-sm text-red-400 hover:text-red-300 transition-colors"
                >
                  ✕ {t("core.usage.removeTenant")}
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <SearchableSelectField
                  fetchFn={fetchSystems}
                  placeholder={t("core.usage.selectSystem")}
                  onChange={(selected) => {
                    const sysId = selected[0]?.id ?? "";
                    updateTenantEntry(entry.id, {
                      systemId: sysId,
                      actors: [],
                    });
                  }}
                />
                <SearchableSelectField
                  fetchFn={fetchCompanies}
                  placeholder={t("core.usage.selectCompany")}
                  onChange={(selected) => {
                    const compId = selected[0]?.id ?? "";
                    updateTenantEntry(entry.id, {
                      companyId: compId,
                      actors: [],
                    });
                  }}
                />
              </div>

              {entry.systemId && entry.companyId && (
                <MultiBadgeField
                  name={t("core.usage.actors")}
                  mode="search"
                  value={entry.actors}
                  onChange={(actors) => updateTenantEntry(entry.id, { actors })}
                  fetchFn={async (search) =>
                    fetchActors(search, entry.companyId, entry.systemId)}
                />
              )}
            </div>
          ))}

          <button
            type="button"
            onClick={addTenantEntry}
            className="w-full backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-primary-green)]/50 rounded-xl p-4 text-center text-[var(--color-primary-green)] hover:bg-white/10 transition-colors"
          >
            + {t("core.usage.addTenant")}
          </button>
        </div>
      )}

      {/* ── Spending badge ── */}
      {expenses.length > 0 && (
        <div className="flex flex-wrap gap-3">
          <span className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-full px-4 py-2 text-sm">
            💰 {t("core.usage.totalSpending")}:{" "}
            <span className="text-[var(--color-primary-green)] font-bold">
              {(totalSpending / 100).toFixed(2)}
            </span>
          </span>
        </div>
      )}

      {/* ── Chart ── */}
      {loading
        ? (
          <div className="flex justify-center py-12">
            <Spinner size="lg" />
          </div>
        )
        : chartData
        ? (
          <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-6">
            <div className="h-80">
              <Bar data={chartData} options={chartOptions} />
            </div>
            {renderSummaryTable(expenses)}
          </div>
        )
        : (
          <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-6">
            <p className="text-[var(--color-light-text)] text-center">
              {t("core.usage.noData")}
            </p>
          </div>
        )}
    </div>
  );
}
