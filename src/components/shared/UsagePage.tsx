"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/src/hooks/useLocale";
import { useAuth } from "@/src/hooks/useAuth";
import { useSystemContext } from "@/src/hooks/useSystemContext";
import Spinner from "@/src/components/shared/Spinner";
import ErrorDisplay from "@/src/components/shared/ErrorDisplay";
import DateRangeFilter from "@/src/components/shared/DateRangeFilter";
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

// Chart.js requires concrete hex values — CSS variables are not supported in canvas rendering.
const EXPENSE_COLORS = [
  "#02d07d", // --color-primary-green
  "#00ccff", // --color-secondary-blue
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
    used: number;
    max: number;
  };
  creditExpenses: {
    resourceKey: string;
    totalAmount: number;
    totalCount: number;
  }[];
}

export default function UsagePage() {
  const { t } = useLocale();
  const { systemToken } = useAuth();
  const { companyId, systemId } = useSystemContext();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<UsageData | null>(null);

  // Date range: last 31 days
  const [startDate, setStartDate] = useState(() =>
    new Date(Date.now() - 31 * 86400000).toISOString().slice(0, 10)
  );
  const [endDate, setEndDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );

  const loadData = useCallback(async () => {
    if (!companyId || !systemId || !systemToken) return;
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
      if (json.success) {
        setData(json.data);
      } else {
        setError(json.error?.message ?? "common.error.generic");
      }
    } catch {
      setError("common.error.network");
    } finally {
      setLoading(false);
    }
  }, [companyId, systemId, systemToken, startDate, endDate]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const formatBytes = (bytes: number) => {
    if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(2)} GB`;
    if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${bytes} B`;
  };

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

  const creditExpenseData = data && data.creditExpenses.length > 0
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

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent">
        {t("billing.usage.title")}
      </h1>

      <ErrorDisplay message={error} />

      {loading
        ? (
          <div className="flex justify-center py-12">
            <Spinner size="lg" />
          </div>
        )
        : data
        ? (
          <>
            {/* ── Storage ── */}
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
                        y: {
                          stacked: true,
                          display: false,
                        },
                      },
                    }}
                  />
                </div>
              )}
            </div>

            {/* ── File Cache ── */}
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
                          y: {
                            stacked: true,
                            display: false,
                          },
                        },
                      }}
                    />
                  </div>
                )}
              </div>
            )}

            {/* ── Operation Count ── */}
            {data.operationCount && data.operationCount.max > 0 && (
              <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-6">
                <h2 className="text-lg font-semibold text-white mb-4">
                  🔢 {t("billing.limits.maxOperationCount")}
                </h2>
                <div className="flex items-center gap-4 mb-4">
                  <p className="text-2xl font-bold text-[var(--color-primary-green)]">
                    {data.operationCount.used.toLocaleString()}
                  </p>
                  <span className="text-[var(--color-light-text)]">/</span>
                  <p className="text-lg text-[var(--color-light-text)]">
                    {data.operationCount.max.toLocaleString()}
                  </p>
                </div>
                <div className="h-16">
                  <Bar
                    data={{
                      labels: [t("billing.limits.maxOperationCount")],
                      datasets: [
                        {
                          label: t("billing.usage.used"),
                          data: [data.operationCount.used],
                          backgroundColor: "rgba(255, 159, 64, 0.7)",
                          borderColor: "#ff9f40",
                          borderWidth: 1,
                          borderRadius: 6,
                        },
                        {
                          label: t("billing.usage.limit"),
                          data: [
                            Math.max(
                              0,
                              data.operationCount.max -
                                data.operationCount.used,
                            ),
                          ],
                          backgroundColor: "rgba(51, 51, 51, 0.5)",
                          borderColor: "#333333",
                          borderWidth: 1,
                          borderRadius: 6,
                        },
                      ],
                    }}
                    options={{
                      indexAxis: "y",
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: {
                        legend: { display: false },
                      },
                      scales: {
                        x: {
                          stacked: true,
                          display: false,
                          max: data.operationCount.max,
                        },
                        y: {
                          stacked: true,
                          display: false,
                        },
                      },
                    }}
                  />
                </div>
              </div>
            )}

            {/* ── Credit Expenses ── */}
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

              {creditExpenseData
                ? (
                  <>
                    <div className="h-64 mb-4">
                      <Bar
                        data={creditExpenseData}
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

                    {/* Summary table */}
                    <div className="border-t border-[var(--color-dark-gray)] pt-4">
                      <h3 className="text-sm font-semibold text-white mb-2">
                        {t("billing.usage.totalExpenses")}
                      </h3>
                      <div className="space-y-2">
                        {data.creditExpenses.map((e, i) => {
                          const label = t(e.resourceKey) !== e.resourceKey
                            ? t(e.resourceKey)
                            : e.resourceKey.split(".").pop() ?? e.resourceKey;
                          const avgCost = e.totalCount > 0
                            ? ((e.totalAmount / e.totalCount) / 100).toFixed(2)
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
                                    backgroundColor:
                                      EXPENSE_COLORS[i % EXPENSE_COLORS.length],
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
                  </>
                )
                : (
                  <p className="text-[var(--color-light-text)]">
                    {t("billing.usage.noExpenses")}
                  </p>
                )}
            </div>
          </>
        )
        : null}
    </div>
  );
}
