"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale } from "@/src/hooks/useLocale";
import { useAuth } from "@/src/hooks/useAuth";
import GenericList from "@/src/components/shared/GenericList";
import Spinner from "@/src/components/shared/Spinner";
import DateRangeFilter from "@/src/components/shared/DateRangeFilter";
import MultiBadgeField from "@/src/components/fields/MultiBadgeField";
import type { CursorParams, PaginatedResult } from "@/src/contracts/common";
import type { FilterValues } from "@/src/components/shared/FilterDropdown";
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

interface CompanySystem {
  systemId: string;
  systemName: string;
  systemSlug: string;
  subscriptionId: string | null;
  planName: string | null;
  planPrice: number;
  status: "active" | "past_due" | "cancelled" | null;
}

interface Company {
  id: string;
  name: string;
  document: string;
  createdAt: string;
  systems: CompanySystem[];
  [key: string]: unknown;
}

interface RevenueChart {
  canceled: number;
  paid: number;
  projected: number;
  errors: number;
}

function formatCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function StatusBadge({ status }: { status: CompanySystem["status"] }) {
  const { t } = useLocale();
  const cls = status === "active"
    ? "bg-[var(--color-primary-green)]/20 text-[var(--color-primary-green)]"
    : status === "past_due"
    ? "bg-yellow-500/20 text-yellow-400"
    : status === "cancelled"
    ? "bg-red-500/20 text-red-400"
    : "bg-white/10 text-[var(--color-light-text)]";

  const label = status === "active"
    ? t("core.companies.active")
    : status === "past_due"
    ? t("core.companies.pastDue")
    : status === "cancelled"
    ? t("core.companies.cancelled")
    : t("core.companies.noSubscription");

  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${cls}`}>
      {label}
    </span>
  );
}

function AccessButton({ item }: { item: Company }) {
  const { t } = useLocale();
  const { exchangeTenant } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const handleClick = async () => {
    const firstSystem = item.systems[0];
    if (!firstSystem) return;
    setLoading(true);
    setError(false);
    try {
      await exchangeTenant(item.id, firstSystem.systemId);
      window.location.href = "/entry";
    } catch {
      setLoading(false);
      setError(true);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleClick}
        disabled={loading || item.systems.length === 0}
        title={t("core.companies.accessHint")}
        className="rounded-lg bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] px-4 py-2 text-sm font-semibold text-black transition-all hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
      >
        {loading
          ? <Spinner size="sm" className="border-black border-t-transparent" />
          : null}
        {t("core.companies.access")}
      </button>
      {error && (
        <span className="text-xs text-red-400">{t("common.error.generic")}</span>
      )}
    </div>
  );
}

function CompanyCard({ item, controls }: {
  item: Company;
  controls: React.ReactNode;
}) {
  const { t } = useLocale();

  return (
    <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-5 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-[var(--color-light-green)]/10 transition-all">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-semibold text-white text-lg">{item.name}</h3>
          <p className="text-sm text-[var(--color-light-text)]">
            {item.document}
          </p>
        </div>
        <div className="flex items-center gap-2">{controls}</div>
      </div>

      {item.systems.length > 0 && (
        <div className="mt-3 space-y-2">
          <h4 className="text-sm font-medium text-[var(--color-light-text)]">
            {t("core.companies.systems")}
          </h4>
          {item.systems.map((sys) => (
            <div
              key={sys.systemId}
              className="flex items-center justify-between rounded-lg bg-white/5 px-4 py-2"
            >
              <div className="flex items-center gap-3">
                <span className="text-white text-sm font-medium">
                  {sys.systemName}
                </span>
                {sys.planName && (
                  <span className="text-xs text-[var(--color-light-text)]">
                    {sys.planName}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                {sys.planPrice > 0 && (
                  <span className="text-xs text-[var(--color-light-text)]">
                    {formatCurrency(sys.planPrice)}
                  </span>
                )}
                <StatusBadge status={sys.status} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function CompaniesPage() {
  const { t } = useLocale();
  const { systemToken } = useAuth();

  const statusLabels: Record<string, string> = {
    active: t("core.companies.active"),
    cancelled: t("core.companies.cancelled"),
    past_due: t("core.companies.pastDue"),
  };
  const reverseStatusLabels: Record<string, string> = Object.fromEntries(
    Object.entries(statusLabels).map(([k, v]) => [v, k]),
  );

  const today = new Date().toISOString().slice(0, 10);
  const thirtyOneDaysAgo = new Date(Date.now() - 31 * 86400000)
    .toISOString()
    .slice(0, 10);
  const [startDate, setStartDate] = useState(thirtyOneDaysAgo);
  const [endDate, setEndDate] = useState(today);
  const [systemFilter, setSystemFilter] = useState<
    { id: string; name: string }[]
  >([]);
  const [planFilter, setPlanFilter] = useState<
    { id: string; name: string }[]
  >([]);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [chart, setChart] = useState<RevenueChart | null>(null);

  const systemIds = useMemo(() => systemFilter.map((s) => s.id), [systemFilter]);
  const planIds = useMemo(() => planFilter.map((p) => p.id), [planFilter]);

  const fetchCompanies = useCallback(
    async (
      params: CursorParams & { search?: string; filters?: FilterValues },
    ): Promise<PaginatedResult<Company>> => {
      const sp = new URLSearchParams();
      if (params.search) sp.set("search", String(params.search));
      if (params.cursor) sp.set("cursor", String(params.cursor));
      sp.set("limit", String(params.limit));
      if (systemIds.length > 0) sp.set("systemIds", systemIds.join(","));
      if (planIds.length > 0) sp.set("planIds", planIds.join(","));
      if (statusFilter.length > 0) sp.set("statuses", statusFilter.join(","));

      const res = await fetch(`/api/core/companies?${sp}`, {
        headers: { Authorization: `Bearer ${systemToken}` },
      });
      const json = await res.json();
      return {
        data: json.data ?? [],
        nextCursor: json.nextCursor ?? null,
        prevCursor: null,
      };
    },
    [systemToken, systemIds, planIds, statusFilter],
  );

  const loadChart = useCallback(async () => {
    if (!startDate || !endDate) return;
    const sp = new URLSearchParams({
      action: "chart",
      startDate,
      endDate,
    });
    if (systemIds.length > 0) sp.set("systemIds", systemIds.join(","));
    if (planIds.length > 0) sp.set("planIds", planIds.join(","));
    if (statusFilter.length > 0) sp.set("statuses", statusFilter.join(","));
    const res = await fetch(`/api/core/companies?${sp}`, {
      headers: { Authorization: `Bearer ${systemToken}` },
    });
    const json = await res.json();
    if (json.success) setChart(json.data);
  }, [systemToken, startDate, endDate, systemIds, planIds, statusFilter]);

  useEffect(() => {
    loadChart();
  }, [loadChart]);

  const fetchSystems = useCallback(
    async (search: string) => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      const res = await fetch(`/api/core/systems?${params}`, {
        headers: { Authorization: `Bearer ${systemToken}` },
      });
      const json = await res.json();
      return (json.data ?? []).map((s: { id: string; name: string }) => ({
        id: s.id,
        name: s.name,
      }));
    },
    [systemToken],
  );

  const fetchPlans = useCallback(
    async (search: string) => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      const res = await fetch(`/api/core/plans?${params}`, {
        headers: { Authorization: `Bearer ${systemToken}` },
      });
      const json = await res.json();
      return (json.data ?? []).map((p: { id: string; name: string }) => ({
        id: p.id,
        name: p.name,
      }));
    },
    [systemToken],
  );

  const chartData = chart
    ? {
      labels: [t("core.companies.chart")],
      datasets: [
        {
          label: t("core.companies.chartCanceled"),
          data: [chart.canceled],
          backgroundColor: "rgba(255, 99, 132, 0.7)",
          borderColor: "#ff6384",
          borderWidth: 1,
          borderRadius: 6,
        },
        {
          label: t("core.companies.chartPaid"),
          data: [chart.paid],
          backgroundColor: "rgba(2, 208, 125, 0.7)",
          borderColor: "#02d07d",
          borderWidth: 1,
          borderRadius: 6,
        },
        {
          label: t("core.companies.chartProjected"),
          data: [chart.projected],
          backgroundColor: "rgba(0, 204, 255, 0.7)",
          borderColor: "#00ccff",
          borderWidth: 1,
          borderRadius: 6,
        },
        {
          label: t("core.companies.chartErrors"),
          data: [chart.errors],
          backgroundColor: "rgba(234, 179, 8, 0.7)",
          borderColor: "#eab308",
          borderWidth: 1,
          borderRadius: 6,
        },
      ],
    }
    : null;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent">
        {t("core.companies.title")}
      </h1>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-sm text-[var(--color-light-text)] mb-1">
            {t("core.companies.dateRange")}
          </label>
          <DateRangeFilter
            maxRangeDays={31}
            onChange={(s, e) => {
              setStartDate(s.toISOString().slice(0, 10));
              setEndDate(e.toISOString().slice(0, 10));
            }}
          />
        </div>
        <div className="min-w-48">
          <label className="block text-sm text-[var(--color-light-text)] mb-1">
            {t("core.companies.systemFilter")}
          </label>
          <MultiBadgeField
            name="systemFilter"
            mode="search"
            value={systemFilter.map((s) => ({ name: s.name }))}
            onChange={(v) =>
              setSystemFilter(
                v.map((x) => {
                  if (typeof x === "object" && "id" in x)
                    return { id: String(x.id), name: x.name ?? "" };
                  return { id: String(x), name: String(x) };
                }),
              )
            }
            fetchFn={fetchSystems}
          />
        </div>
        <div className="min-w-48">
          <label className="block text-sm text-[var(--color-light-text)] mb-1">
            {t("core.companies.planFilter")}
          </label>
          <MultiBadgeField
            name="planFilter"
            mode="search"
            value={planFilter.map((p) => ({ name: p.name }))}
            onChange={(v) =>
              setPlanFilter(
                v.map((x) => {
                  if (typeof x === "object" && "id" in x)
                    return { id: String(x.id), name: x.name ?? "" };
                  return { id: String(x), name: String(x) };
                }),
              )
            }
            fetchFn={fetchPlans}
          />
        </div>
        <div className="min-w-48">
          <label className="block text-sm text-[var(--color-light-text)] mb-1">
            {t("core.companies.statusFilter")}
          </label>
          <MultiBadgeField
            name="statusFilter"
            mode="search"
            value={statusFilter.map(
              (s) => statusLabels[s] ?? s,
            )}
            onChange={(v) =>
              setStatusFilter(
                v.map((x) => {
                  const label = typeof x === "string" ? x : x.name;
                  return reverseStatusLabels[label] ?? label;
                }),
              )
            }
            staticOptions={Object.values(statusLabels)}
          />
        </div>
      </div>

      {/* Revenue Chart */}
      {chartData && (
        <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-2xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4 bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent">
            {t("core.companies.revenueOverview")}
          </h2>
          <div className="h-64">
            <Bar
              data={chartData}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: {
                    labels: { color: "#cccccc", font: { size: 12 } },
                  },
                  tooltip: {
                    callbacks: {
                      label: (ctx) =>
                        `${ctx.dataset.label}: ${
                          formatCurrency(ctx.parsed.y ?? 0)
                        }`,
                    },
                  },
                },
                scales: {
                  x: {
                    ticks: { color: "#cccccc" },
                    grid: { color: "rgba(51,51,51,0.5)" },
                  },
                  y: {
                    ticks: {
                      color: "#cccccc",
                      callback: (val) => formatCurrency(val as number),
                    },
                    grid: { color: "rgba(51,51,51,0.5)" },
                  },
                },
              }}
            />
          </div>
        </div>
      )}

      {/* Company List via GenericList */}
      <GenericList<Company>
        entityName={t("core.companies.title")}
        searchEnabled
        createEnabled={false}
        controlButtons={[]}
        actionComponents={[{ key: "access", component: AccessButton }]}
        fetchFn={fetchCompanies}
        renderItem={(item, controls) => (
          <CompanyCard item={item} controls={controls} />
        )}
      />
    </div>
  );
}
