"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "@/src/hooks/useLocale";
import { useAuth } from "@/src/hooks/useAuth";
import { useSystemContext } from "@/src/hooks/useSystemContext";
import Spinner from "@/src/components/shared/Spinner";
import ErrorDisplay from "@/src/components/shared/ErrorDisplay";
import DateRangeFilter from "@/src/components/shared/DateRangeFilter";
import MultiBadgeField from "@/src/components/fields/MultiBadgeField";
import type { BadgeValue } from "@/src/components/fields/MultiBadgeField";
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

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
);

const EXPENSE_COLORS = [
  "#02d07d",
  "#00ccff",
  "#ff6384",
  "#ffce56",
  "#9966ff",
  "#ff9f40",
  "#4bc0c0",
  "#e7e9ed",
  "#36a2eb",
  "#c9cbcf",
];

interface UsageData {
  storage: {
    usedBytes: number;
    limitBytes: number;
  };
  cache: {
    usedBytes: number;
    maxBytes: number;
    fileCount: number;
  };
  operationCount: {
    resourceKey: string;
    used: number;
    max: number;
  }[];
  creditExpenses: {
    resourceKey: string;
    totalAmount: number;
    totalCount: number;
  }[];
}

interface CreditExpenseRow {
  resourceKey: string;
  totalAmount: number;
  totalCount: number;
}

interface UsagePageProps {
  mode?: "tenant" | "core";
}

function extractIds(badges: BadgeValue[]): string[] {
  return badges.map((b) =>
    typeof b === "string"
      ? b
      : (b as { name: string; id?: string }).id ?? b.name
  );
}

export default function UsagePage({ mode = "tenant" }: UsagePageProps) {
  const { t } = useLocale();
  const { systemToken } = useAuth();

  const isCore = mode === "core";

  // Only use system context for tenant mode
  const tenant = isCore ? null : useSystemContext();
  const companyId = isCore ? "0" : tenant?.companyId;
  const systemId = isCore ? "0" : tenant?.systemId;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<UsageData | null>(null);
  const [coreExpenses, setCoreExpenses] = useState<CreditExpenseRow[]>([]);

  const [startDate, setStartDate] = useState(() =>
    new Date(Date.now() - 31 * 86400000).toISOString().slice(0, 10)
  );
  const [endDate, setEndDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );

  // Core filters
  const [companyFilter, setCompanyFilter] = useState<BadgeValue[]>([]);
  const [systemFilter, setSystemFilter] = useState<BadgeValue[]>([]);
  const [planFilter, setPlanFilter] = useState<BadgeValue[]>([]);
  const [tokenFilter, setTokenFilter] = useState<BadgeValue[]>([]);
  const [connectedAppFilter, setConnectedAppFilter] = useState<BadgeValue[]>(
    [],
  );
  const [userFilter, setUserFilter] = useState<BadgeValue[]>([]);
  const [clickedResourceKey, setClickedResourceKey] = useState<string | null>(
    null,
  );

  const cancelledRef = useRef(false);

  // Tenant data loader
  const loadTenantData = useCallback(async () => {
    if (!companyId || !systemId || !systemToken) return;
    cancelledRef.current = false;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        companyId,
        systemId,
        startDate,
        endDate,
      });
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
  }, [companyId, systemId, systemToken, startDate, endDate]);

  // Core data loader
  const loadCoreData = useCallback(async () => {
    if (!systemToken) return;
    cancelledRef.current = false;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ startDate, endDate, mode: "core" });

      const cIds = extractIds(companyFilter);
      if (cIds.length) params.set("companyIds", cIds.join(","));

      const sysIds = extractIds(systemFilter);
      if (sysIds.length) params.set("systemIds", sysIds.join(","));

      const pIds = extractIds(planFilter);
      if (pIds.length) params.set("planIds", pIds.join(","));

      const actorIds = [
        ...extractIds(tokenFilter),
        ...extractIds(connectedAppFilter),
        ...extractIds(userFilter),
      ];
      if (actorIds.length) params.set("actorIds", actorIds.join(","));

      const res = await fetch(`/api/usage?${params}`, {
        headers: { Authorization: `Bearer ${systemToken}` },
      });
      const json = await res.json();
      if (!cancelledRef.current) {
        if (json.success) {
          setCoreExpenses(json.data.creditExpenses ?? []);
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
    companyFilter,
    systemFilter,
    planFilter,
    tokenFilter,
    connectedAppFilter,
    userFilter,
  ]);

  useEffect(() => {
    if (isCore) {
      loadCoreData();
    } else {
      loadTenantData();
    }
    return () => {
      cancelledRef.current = true;
    };
  }, [isCore, loadCoreData, loadTenantData]);

  const formatBytes = (bytes: number) => {
    if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(2)} GB`;
    if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${bytes} B`;
  };

  // Core fetch helpers
  const fetchCompanies = useCallback(
    async (search: string): Promise<BadgeValue[]> => {
      if (!systemToken) return [];
      const res = await fetch(
        `/api/core/companies?search=${encodeURIComponent(search)}&limit=20`,
        { headers: { Authorization: `Bearer ${systemToken}` } },
      );
      const json = await res.json();
      return (json.data ?? []).map((c: { id: string; name: string }) => ({
        name: c.name,
        id: c.id,
      }));
    },
    [systemToken],
  );

  const fetchSystems = useCallback(
    async (search: string): Promise<BadgeValue[]> => {
      if (!systemToken) return [];
      const res = await fetch(
        `/api/core/systems?search=${encodeURIComponent(search)}&limit=20`,
        { headers: { Authorization: `Bearer ${systemToken}` } },
      );
      const json = await res.json();
      return (json.data ?? []).map((s: { id: string; name: string }) => ({
        name: s.name,
        id: s.id,
      }));
    },
    [systemToken],
  );

  const fetchPlans = useCallback(
    async (search: string): Promise<BadgeValue[]> => {
      if (!systemToken) return [];
      const res = await fetch(
        `/api/core/plans?search=${encodeURIComponent(search)}&limit=20`,
        { headers: { Authorization: `Bearer ${systemToken}` } },
      );
      const json = await res.json();
      return (json.data ?? []).map((p: { id: string; name: string }) => ({
        name: t(p.name) !== p.name ? t(p.name) : p.name,
        id: p.id,
      }));
    },
    [systemToken, t],
  );

  const fetchTokens = useCallback(
    async (search: string): Promise<BadgeValue[]> => {
      if (!systemToken) return [];
      const res = await fetch("/api/tokens?limit=20", {
        headers: { Authorization: `Bearer ${systemToken}` },
      });
      const json = await res.json();
      return ((json.data ?? []) as { id: string; name: string }[])
        .filter((tk) => tk.name.toLowerCase().includes(search.toLowerCase()))
        .map((tk) => ({ name: tk.name, id: tk.id }));
    },
    [systemToken],
  );

  const fetchConnectedApps = useCallback(
    async (search: string): Promise<BadgeValue[]> => {
      if (!systemToken) return [];
      const res = await fetch("/api/connected-apps?limit=20", {
        headers: { Authorization: `Bearer ${systemToken}` },
      });
      const json = await res.json();
      return ((json.data ?? []) as { id: string; name: string }[])
        .filter((app) => app.name.toLowerCase().includes(search.toLowerCase()))
        .map((app) => ({ name: app.name, id: app.id }));
    },
    [systemToken],
  );

  const fetchUsers = useCallback(
    async (search: string): Promise<BadgeValue[]> => {
      if (!systemToken) return [];
      const res = await fetch(
        `/api/users?search=${encodeURIComponent(search)}&limit=20`,
        { headers: { Authorization: `Bearer ${systemToken}` } },
      );
      const json = await res.json();
      return (
        (json.data ?? []) as { id: string; name?: string; email: string }[]
      ).map((u) => ({ name: u.name ?? u.email, id: u.id }));
    },
    [systemToken],
  );

  // ── Tenant chart data ──

  const storageData = data
    ? {
      labels: [t("billing.usage.storage")],
      datasets: [
        {
          label: t("billing.usage.used"),
          data: [data.storage.usedBytes],
          backgroundColor: "rgba(2, 208, 125, 0.7)",
          borderColor: "#02d07d",
          borderWidth: 1,
          borderRadius: 6,
        },
        {
          label: t("billing.usage.limit"),
          data: [Math.max(0, data.storage.limitBytes - data.storage.usedBytes)],
          backgroundColor: "rgba(51, 51, 51, 0.5)",
          borderColor: "#333333",
          borderWidth: 1,
          borderRadius: 6,
        },
      ],
    }
    : null;

  const cacheData = data && data.cache && data.cache.maxBytes > 0
    ? {
      labels: [t("billing.usage.fileCache")],
      datasets: [
        {
          label: t("billing.usage.used"),
          data: [data.cache.usedBytes],
          backgroundColor: "rgba(0, 204, 255, 0.7)",
          borderColor: "#00ccff",
          borderWidth: 1,
          borderRadius: 6,
        },
        {
          label: t("billing.usage.limit"),
          data: [Math.max(0, data.cache.maxBytes - data.cache.usedBytes)],
          backgroundColor: "rgba(51, 51, 51, 0.5)",
          borderColor: "#333333",
          borderWidth: 1,
          borderRadius: 6,
        },
      ],
    }
    : null;

  const tenantExpenseData = data && data.creditExpenses.length > 0
    ? {
      labels: data.creditExpenses.map((e) => {
        const translated = t(e.resourceKey);
        return translated !== e.resourceKey
          ? translated
          : e.resourceKey.split(".").pop() ?? e.resourceKey;
      }),
      datasets: [
        {
          label: t("billing.usage.totalExpenses"),
          data: data.creditExpenses.map((e) => e.totalAmount / 100),
          backgroundColor: data.creditExpenses.map(
            (_, i) => EXPENSE_COLORS[i % EXPENSE_COLORS.length],
          ),
          borderRadius: 6,
        },
      ],
    }
    : null;

  // ── Core chart data (stacked: amount + count) ──

  const coreTotalSpending = coreExpenses.reduce(
    (sum, e) => sum + e.totalAmount,
    0,
  );

  const clickedEntry = clickedResourceKey
    ? coreExpenses.find((e) => e.resourceKey === clickedResourceKey)
    : null;

  const coreChartData = coreExpenses.length > 0
    ? {
      labels: coreExpenses.map((e) => {
        const translated = t(e.resourceKey);
        return translated !== e.resourceKey
          ? translated
          : e.resourceKey.split(".").pop() ?? e.resourceKey;
      }),
      datasets: [
        {
          label: t("core.usage.chart.amount"),
          data: coreExpenses.map((e) => e.totalAmount / 100),
          backgroundColor: "rgba(2, 208, 125, 0.7)",
          borderColor: "#02d07d",
          borderWidth: 1,
          borderRadius: 6,
          yAxisID: "y",
        },
        {
          label: t("core.usage.chart.count"),
          data: coreExpenses.map((e) => e.totalCount),
          backgroundColor: "rgba(0, 204, 255, 0.7)",
          borderColor: "#00ccff",
          borderWidth: 1,
          borderRadius: 6,
          yAxisID: "y1",
        },
      ],
    }
    : null;

  // ── Shared summary table renderer ──

  function renderSummaryTable(expenses: CreditExpenseRow[]) {
    return (
      <div className="border-t border-[var(--color-dark-gray)] pt-4">
        <h3 className="text-sm font-semibold text-white mb-2">
          {t("billing.usage.totalExpenses")}
        </h3>
        <div className="space-y-2">
          {expenses.map((e, i) => {
            const label = t(e.resourceKey) !== e.resourceKey
              ? t(e.resourceKey)
              : e.resourceKey.split(".").pop() ?? e.resourceKey;
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
                      backgroundColor: isCore
                        ? i % 2 === 0 ? "#02d07d" : "#00ccff"
                        : EXPENSE_COLORS[i % EXPENSE_COLORS.length],
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

  // ── Render ──

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent">
        {isCore ? t("core.usage.title") : t("billing.usage.title")}
      </h1>

      <ErrorDisplay message={error} />

      {loading
        ? (
          <div className="flex justify-center py-12">
            <Spinner size="lg" />
          </div>
        )
        : isCore
        ? (
          /* ── Core mode ── */
          <>
            {/* Filters */}
            <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-white">
                  {t("core.usage.chart.amount")}
                </h2>
                <DateRangeFilter
                  maxRangeDays={31}
                  onChange={(s, e) => {
                    setStartDate(s.toISOString().slice(0, 10));
                    setEndDate(e.toISOString().slice(0, 10));
                  }}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <MultiBadgeField
                  name={t("core.usage.filters.companies")}
                  mode="search"
                  value={companyFilter}
                  onChange={setCompanyFilter}
                  fetchFn={fetchCompanies}
                />
                <MultiBadgeField
                  name={t("core.usage.filters.systems")}
                  mode="search"
                  value={systemFilter}
                  onChange={setSystemFilter}
                  fetchFn={fetchSystems}
                />
                <MultiBadgeField
                  name={t("core.usage.filters.plans")}
                  mode="search"
                  value={planFilter}
                  onChange={setPlanFilter}
                  fetchFn={fetchPlans}
                />
                <MultiBadgeField
                  name={t("core.usage.filters.tokens")}
                  mode="search"
                  value={tokenFilter}
                  onChange={setTokenFilter}
                  fetchFn={fetchTokens}
                />
                <MultiBadgeField
                  name={t("core.usage.filters.connectedApps")}
                  mode="search"
                  value={connectedAppFilter}
                  onChange={setConnectedAppFilter}
                  fetchFn={fetchConnectedApps}
                />
                <MultiBadgeField
                  name={t("core.usage.filters.users")}
                  mode="search"
                  value={userFilter}
                  onChange={setUserFilter}
                  fetchFn={fetchUsers}
                />
              </div>
            </div>

            {/* Badges */}
            <div className="flex flex-wrap gap-3">
              <span className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-full px-4 py-2 text-sm">
                💰 {t("core.usage.totalSpending")}:{" "}
                <span className="text-[var(--color-primary-green)] font-bold">
                  {(coreTotalSpending / 100).toFixed(2)}
                </span>
              </span>
              {clickedEntry && (
                <span className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-secondary-blue)]/50 rounded-full px-4 py-2 text-sm">
                  📊 {t("core.usage.averageSpending")}:{" "}
                  <span className="text-[var(--color-secondary-blue)] font-bold">
                    {clickedEntry.totalCount > 0
                      ? (
                        (clickedEntry.totalAmount / clickedEntry.totalCount) /
                        100
                      ).toFixed(4)
                      : "0.00"}
                  </span>
                </span>
              )}
            </div>

            {/* Stacked chart */}
            {coreChartData
              ? (
                <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-6">
                  <div className="h-80">
                    <Bar
                      data={coreChartData}
                      options={{
                        responsive: true,
                        maintainAspectRatio: false,
                        onClick: (_event, elements) => {
                          if (elements.length > 0) {
                            const idx = elements[0].index;
                            setClickedResourceKey(
                              coreExpenses[idx].resourceKey,
                            );
                          }
                        },
                        plugins: {
                          legend: { labels: { color: "#cccccc" } },
                          tooltip: {
                            callbacks: {
                              label: (ctx) => {
                                if (ctx.datasetIndex === 0) {
                                  return `${ctx.dataset.label}: ${
                                    (ctx.raw as number).toFixed(2)
                                  }`;
                                }
                                return `${ctx.dataset.label}: ${ctx.raw}`;
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
                            position: "left",
                            title: {
                              display: true,
                              text: t("core.usage.chart.amount"),
                              color: "#cccccc",
                            },
                            ticks: { color: "#cccccc" },
                            grid: { color: "rgba(51,51,51,0.3)" },
                          },
                          y1: {
                            position: "right",
                            title: {
                              display: true,
                              text: t("core.usage.chart.count"),
                              color: "#cccccc",
                            },
                            ticks: { color: "#cccccc" },
                            grid: { drawOnChartArea: false },
                          },
                        },
                      }}
                    />
                  </div>
                  {renderSummaryTable(coreExpenses)}
                </div>
              )
              : (
                <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-6">
                  <p className="text-[var(--color-light-text)] text-center">
                    {t("core.usage.noData")}
                  </p>
                </div>
              )}
          </>
        )
        : data
        ? (
          /* ── Tenant mode ── */
          <>
            {/* Storage */}
            <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-6">
              <h2 className="text-lg font-semibold text-white mb-4">
                💾 {t("billing.usage.storage")}
              </h2>
              <div className="flex items-center gap-4 mb-4">
                <p className="text-2xl font-bold text-[var(--color-primary-green)]">
                  {formatBytes(data.storage.usedBytes)}
                </p>
                <span className="text-[var(--color-light-text)]">/</span>
                <p className="text-lg text-[var(--color-light-text)]">
                  {formatBytes(data.storage.limitBytes)}
                </p>
              </div>
              {storageData && (
                <div className="h-16">
                  <Bar
                    data={storageData}
                    options={{
                      indexAxis: "y",
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: {
                        legend: { display: false },
                        tooltip: {
                          callbacks: {
                            label: (ctx) => formatBytes(ctx.raw as number),
                          },
                        },
                      },
                      scales: {
                        x: {
                          stacked: true,
                          display: false,
                          max: data.storage.limitBytes,
                        },
                        y: { stacked: true, display: false },
                      },
                    }}
                  />
                </div>
              )}
            </div>

            {/* File Cache */}
            {data.cache && data.cache.maxBytes > 0 && (
              <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-6">
                <h2 className="text-lg font-semibold text-white mb-4">
                  🗂️ {t("billing.usage.fileCache")}
                </h2>
                <div className="flex items-center gap-4 mb-4">
                  <p className="text-2xl font-bold text-[var(--color-secondary-blue)]">
                    {formatBytes(data.cache.usedBytes)}
                  </p>
                  <span className="text-[var(--color-light-text)]">/</span>
                  <p className="text-lg text-[var(--color-light-text)]">
                    {formatBytes(data.cache.maxBytes)}
                  </p>
                  <span className="text-sm text-[var(--color-light-text)]">
                    ({data.cache.fileCount} {t("billing.usage.files")})
                  </span>
                </div>
                {cacheData && (
                  <div className="h-16">
                    <Bar
                      data={cacheData}
                      options={{
                        indexAxis: "y",
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                          legend: { display: false },
                          tooltip: {
                            callbacks: {
                              label: (ctx) => formatBytes(ctx.raw as number),
                            },
                          },
                        },
                        scales: {
                          x: {
                            stacked: true,
                            display: false,
                            max: data.cache.maxBytes,
                          },
                          y: { stacked: true, display: false },
                        },
                      }}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Credit Expenses */}
            <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-white">
                  🪙 {t("billing.usage.creditExpenses")}
                </h2>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-[var(--color-light-text)]">
                    {t("billing.usage.dateRange")}:
                  </label>
                  <DateRangeFilter
                    maxRangeDays={31}
                    onChange={(s, e) => {
                      setStartDate(s.toISOString().slice(0, 10));
                      setEndDate(e.toISOString().slice(0, 10));
                    }}
                  />
                </div>
              </div>

              {tenantExpenseData
                ? (
                  <>
                    <div className="h-64 mb-4">
                      <Bar
                        data={tenantExpenseData}
                        options={{
                          responsive: true,
                          maintainAspectRatio: false,
                          plugins: {
                            legend: { display: false },
                            tooltip: {
                              callbacks: {
                                label: (ctx) =>
                                  `${ctx.label}: ${
                                    (ctx.raw as number).toFixed(2)
                                  }`,
                              },
                            },
                          },
                          scales: {
                            x: {
                              ticks: { color: "#cccccc", font: { size: 11 } },
                              grid: { color: "rgba(51,51,51,0.3)" },
                            },
                            y: {
                              ticks: { color: "#cccccc" },
                              grid: { color: "rgba(51,51,51,0.3)" },
                            },
                          },
                        }}
                      />
                    </div>
                    {renderSummaryTable(data.creditExpenses)}
                  </>
                )
                : (
                  <p className="text-[var(--color-light-text)]">
                    {t("billing.usage.noExpenses")}
                  </p>
                )}
            </div>

            {/* Operation Count */}
            {data.operationCount && data.operationCount.length > 0 && (
              <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-6">
                <h2 className="text-lg font-semibold text-white mb-4">
                  🔢 {t("billing.limits.maxOperationCount")}
                </h2>
                <div className="space-y-5">
                  {data.operationCount.map((entry) => {
                    const label = t("billing.limits." + entry.resourceKey);
                    const pct = entry.max > 0
                      ? Math.min(100, (entry.used / entry.max) * 100)
                      : 0;
                    return (
                      <div key={entry.resourceKey}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm text-[var(--color-light-text)]">
                            🔢 {label}
                          </span>
                          <span className="text-sm text-white font-medium">
                            {entry.used.toLocaleString()}{" "}
                            <span className="text-[var(--color-light-text)]">
                              /
                            </span>{" "}
                            <span className="text-[var(--color-light-text)]">
                              {entry.max > 0
                                ? entry.max.toLocaleString()
                                : t("billing.limits.unlimited")}
                            </span>
                          </span>
                        </div>
                        {entry.max > 0 && (
                          <div className="w-full h-4 bg-[var(--color-dark-gray)] rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] transition-all duration-300"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        )}
                        {entry.max === 0 && (
                          <p className="text-xs text-[var(--color-light-text)] mt-1">
                            {t("billing.limits.unlimited")}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )
        : null}
    </div>
  );
}
