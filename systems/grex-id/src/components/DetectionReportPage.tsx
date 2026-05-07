"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DateRangeFilter from "@/src/components/filters/DateRangeFilter";
import MultiBadgeFieldFilter from "@/src/components/filters/MultiBadgeFieldFilter";
import DateView from "@/src/components/shared/DateView";
import LeadView from "@/src/components/shared/LeadView";
import Spinner from "@/src/components/shared/Spinner";
import DownloadData from "@/src/components/shared/DownloadData";
import GenericList from "@/src/components/shared/GenericList";
import type {
  CursorParams,
  PaginatedResult,
} from "@/src/contracts/high-level/pagination";
import type { BadgeValue } from "@/src/contracts/high-level/components";
import type { LeadViewData } from "@/src/contracts/high-level/lead";
import type { TagView } from "@/src/contracts/high-level/tags";
import { Bar, Pie } from "react-chartjs-2";
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Title,
  Tooltip,
} from "chart.js";
import { useTenantContext } from "@/src/hooks/useTenantContext";

ChartJS.register(
  ArcElement,
  BarElement,
  CategoryScale,
  LinearScale,
  Title,
  Tooltip,
  Legend,
);

import type {
  DetectionReportItem,
  DetectionStats,
} from "@systems/grex-id/src/contracts/high-level/detection";

function formatDateForExport(iso: string, locale: string): string {
  try {
    return new Date(iso).toLocaleString(
      locale === "pt-BR" ? "pt-BR" : "en-US",
      { dateStyle: "short", timeStyle: "short" },
    );
  } catch {
    return iso;
  }
}

function ClassificationBadge(
  { classification, t }: { classification: string; t: (k: string) => string },
) {
  const styles: Record<string, string> = {
    member:
      "bg-[var(--color-primary-green)]/10 text-[var(--color-primary-green)] border-[var(--color-primary-green)]/30",
    visitor: "bg-yellow-500/10 text-yellow-400 border-yellow-400/30",
    unknown: "bg-red-500/10 text-red-400 border-red-400/30",
    suppressed: "bg-purple-500/10 text-purple-400 border-purple-400/30",
  };
  const labels: Record<string, string> = {
    member: t("systems.grex-id.report.member"),
    visitor: t("systems.grex-id.report.visitor"),
    unknown: t("systems.grex-id.report.unknown"),
    suppressed: t("systems.grex-id.report.suppressed"),
  };

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
        styles[classification] ?? styles.unknown
      }`}
    >
      {labels[classification] ?? classification}
    </span>
  );
}

export default function DetectionReportPage() {
  const { t, locale, timezoneOffsetMinutes } = useTenantContext();
  const { systemToken } = useTenantContext();
  const [stats, setStats] = useState<DetectionStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [chartFilters, setChartFilters] = useState<Record<string, unknown>>(
    {},
  );
  const [listReloadKey, setListReloadKey] = useState(0);
  const prevStatsRef = useRef<DetectionStats | null>(null);
  const tagMapRef = useRef<Map<string, TagView>>(new Map());

  const resolveTagIds = useCallback(
    (badges: BadgeValue[]): string[] => {
      return badges.map((b) => {
        const name = typeof b === "string" ? b : b.name;
        for (const tag of tagMapRef.current.values()) {
          if (tag.name === name) return tag.id;
        }
        return name;
      });
    },
    [],
  );

  const fetchTags = useCallback(
    async (search: string): Promise<BadgeValue[]> => {
      if (!systemToken) return [];
      const res = await fetch(
        `/api/tags?search=${encodeURIComponent(search)}`,
        { headers: { Authorization: `Bearer ${systemToken}` } },
      );
      const json = await res.json();
      const tags: TagView[] = json.items ?? [];
      for (const tag of tags) {
        tagMapRef.current.set(tag.name, tag);
      }
      return tags.map((tag) => ({ name: tag.name, color: tag.color }));
    },
    [systemToken],
  );

  const fetchStats = useCallback(
    async (startDate: string, endDate: string, tagIds?: string[]) => {
      if (!systemToken) return;
      setLoading(true);
      try {
        const qs = new URLSearchParams({
          action: "stats",
          startDate,
          endDate,
        });
        if (tagIds && tagIds.length > 0) {
          qs.set("tagIds", tagIds.join(","));
        }

        const res = await fetch(
          `/api/systems/grex-id/detections?${qs.toString()}`,
          { headers: { Authorization: `Bearer ${systemToken}` } },
        );
        const json = await res.json();

        if (json.success) {
          setStats(json.data ?? null);
        }
      } finally {
        setLoading(false);
      }
    },
    [systemToken],
  );

  useEffect(() => {
    const dateRange = chartFilters.dateRange as [Date, Date] | undefined;
    const tagBadges = chartFilters.tagIds as BadgeValue[] | undefined;
    if (dateRange?.[0] && dateRange?.[1]) {
      fetchStats(
        dateRange[0].toISOString(),
        dateRange[1].toISOString(),
        tagBadges ? resolveTagIds(tagBadges) : undefined,
      );
    }
  }, [chartFilters, fetchStats, resolveTagIds]);

  useEffect(() => {
    if (stats !== prevStatsRef.current) {
      prevStatsRef.current = stats;
      setListReloadKey((k) => k + 1);
    }
  }, [stats]);

  const individuals = stats?.individuals ?? [];
  const uniqueCounts = useMemo(
    () => ({
      member: stats?.uniqueMembers ?? 0,
      visitor: stats?.uniqueVisitors ?? 0,
      unknown: stats?.uniqueUnknowns ?? 0,
      suppressed: stats?.uniqueSuppressed ?? 0,
    }),
    [stats],
  );

  const fetchIndividuals = useCallback(
    async (
      params: CursorParams,
    ): Promise<PaginatedResult<DetectionReportItem>> => {
      if (!systemToken) return { items: [], total: 0, hasMore: false };
      const dateRange = chartFilters.dateRange as [Date, Date] | undefined;
      const tagBadges = chartFilters.tagIds as BadgeValue[] | undefined;

      const qs = new URLSearchParams();
      if (dateRange?.[0] && dateRange?.[1]) {
        qs.set("startDate", dateRange[0].toISOString());
        qs.set("endDate", dateRange[1].toISOString());
      }
      if (params.cursor) qs.set("cursor", params.cursor);
      if (params.limit) qs.set("limit", String(params.limit));
      if (tagBadges && tagBadges.length > 0) {
        qs.set("tagIds", resolveTagIds(tagBadges).join(","));
      }

      const res = await fetch(
        `/api/systems/grex-id/detections?${qs.toString()}`,
        { headers: { Authorization: `Bearer ${systemToken}` } },
      );
      const json = await res.json();
      return {
        items: json.items ?? [],
        total: json.total ?? 0,
        hasMore: json.hasMore ?? false,
        nextCursor: json.nextCursor,
      };
    },
    [systemToken, chartFilters, resolveTagIds],
  );

  const pieCategories = useMemo(
    () => [
      {
        key: "member" as const,
        label: t("systems.grex-id.report.member"),
        bg: "rgba(2, 208, 125, 0.75)",
        border: "#02d07d",
        dot: "bg-[var(--color-primary-green)]",
      },
      {
        key: "visitor" as const,
        label: t("systems.grex-id.report.visitor"),
        bg: "rgba(234, 179, 8, 0.75)",
        border: "#eab308",
        dot: "bg-yellow-500",
      },
      {
        key: "unknown" as const,
        label: t("systems.grex-id.report.unknown"),
        bg: "rgba(239, 68, 68, 0.75)",
        border: "#ef4444",
        dot: "bg-red-500",
      },
      {
        key: "suppressed" as const,
        label: t("systems.grex-id.report.suppressed"),
        bg: "rgba(168, 85, 247, 0.75)",
        border: "#a855f7",
        dot: "bg-purple-500",
      },
    ],
    [t],
  );

  const nonZeroPieCategories = useMemo(
    () => pieCategories.filter((c) => uniqueCounts[c.key] > 0),
    [pieCategories, uniqueCounts],
  );

  const pieData = useMemo(
    () => ({
      labels: nonZeroPieCategories.map((c) => c.label),
      datasets: [
        {
          data: nonZeroPieCategories.map((c) => uniqueCounts[c.key]),
          backgroundColor: nonZeroPieCategories.map((c) => c.bg),
          borderColor: nonZeroPieCategories.map((c) => c.border),
          borderWidth: 2,
          hoverOffset: 8,
        },
      ],
    }),
    [nonZeroPieCategories, uniqueCounts],
  );

  const localHourLabels = useMemo(
    () =>
      Array.from({ length: 24 }, (_, i) => {
        const localH = ((i + Math.round(timezoneOffsetMinutes / 60)) + 24) % 24;
        return `${String(localH).padStart(2, "0")}:00`;
      }),
    [timezoneOffsetMinutes],
  );

  const stackedHourData = useMemo(() => {
    const buckets = stats?.hourlyBuckets ?? [];
    const allDatasets = [
      {
        key: "unknown" as const,
        label: t("systems.grex-id.report.unknown"),
        bg: "rgba(239, 68, 68, 0.7)",
        border: "#ef4444",
      },
      {
        key: "visitor" as const,
        label: t("systems.grex-id.report.visitor"),
        bg: "rgba(234, 179, 8, 0.7)",
        border: "#eab308",
      },
      {
        key: "member" as const,
        label: t("systems.grex-id.report.member"),
        bg: "rgba(2, 208, 125, 0.7)",
        border: "#02d07d",
      },
      {
        key: "suppressed" as const,
        label: t("systems.grex-id.report.suppressed"),
        bg: "rgba(168, 85, 247, 0.7)",
        border: "#a855f7",
      },
    ];

    // Filter out hour columns where all categories are 0
    const nonEmptyIndices = Array.from({ length: 24 }, (_, i) => i)
      .filter((i) =>
        buckets[i] &&
        (buckets[i].unknown > 0 || buckets[i].visitor > 0 ||
          buckets[i].member > 0 || buckets[i].suppressed > 0)
      );

    // Filter out category stacks where all values across remaining hours are 0
    const nonEmptyDatasets = allDatasets.filter((ds) =>
      nonEmptyIndices.some((i) => buckets[i][ds.key] > 0)
    );

    return {
      labels: nonEmptyIndices.map((i) => localHourLabels[i]),
      datasets: nonEmptyDatasets.map((ds) => ({
        label: ds.label,
        data: nonEmptyIndices.map((i) => buckets[i][ds.key]),
        backgroundColor: ds.bg,
        borderColor: ds.border,
        borderWidth: 1,
      })),
    };
  }, [stats?.hourlyBuckets, localHourLabels, t]);

  const chartTextColor = "#cccccc";
  const chartGridColor = "rgba(51, 51, 51, 0.4)";

  const stackedBarOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "bottom" as const,
          labels: {
            color: chartTextColor,
            padding: 12,
            usePointStyle: true,
            font: { size: 11 },
          },
        },
        title: {
          display: true,
          text: t("systems.grex-id.report.chartByHourStacked"),
          color: chartTextColor,
          font: { size: 14, weight: "bold" as const },
          padding: { bottom: 16 },
        },
        tooltip: {
          backgroundColor: "rgba(0,0,0,0.85)",
          titleColor: "#fff",
          bodyColor: "#ccc",
          borderColor: "#333",
          borderWidth: 1,
          cornerRadius: 8,
          padding: 10,
        },
      },
      scales: {
        x: {
          stacked: true,
          ticks: { color: chartTextColor, font: { size: 11 } },
          grid: { color: chartGridColor },
        },
        y: {
          stacked: true,
          beginAtZero: true,
          ticks: {
            color: chartTextColor,
            stepSize: 1,
            precision: 0,
          },
          grid: { color: chartGridColor },
        },
      },
    }),
    [t],
  );

  const exportData = useCallback(async () => {
    return individuals.map((item) => ({
      [t("systems.grex-id.report.exportId")]:
        item.classification === "member" || item.classification === "suppressed"
          ? item.leadId ?? item.faceId
          : item.faceId,
      [t("systems.grex-id.report.exportClassification")]: t(
        `systems.grex-id.report.${item.classification}`,
      ),
      [t("systems.grex-id.report.exportName")]: item.leadName ??
        t("systems.grex-id.report.unknownPerson"),
      [t("systems.grex-id.report.exportDetectionCount")]: item.detectionCount,
      [t("systems.grex-id.report.exportLocation")]: item.locationName,
      [t("systems.grex-id.report.exportDate")]: formatDateForExport(
        item.lastDetectedAt,
        locale,
      ),
      [t("systems.grex-id.report.exportEmail")]: item.leadEmail ?? "",
      [t("systems.grex-id.report.exportPhone")]: item.leadPhone ?? "",
      [t("systems.grex-id.report.exportOwner")]: item.ownerName ?? "",
      [t("systems.grex-id.report.score")]: item.bestScore.toFixed(2),
    }));
  }, [individuals, t, locale]);

  const hasChartData = individuals.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <span className="text-2xl">📊</span>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent">
            {t("systems.grex-id.report.title")}
          </h1>
        </div>
        {hasChartData && (
          <DownloadData
            data={exportData}
            fileName={`detection-report-${
              (chartFilters.dateRange as [Date, Date])?.[0]
                ?.toISOString()
                ?.slice(0, 10) ?? ""
            }`}
            sheetName={t("systems.grex-id.report.title")}
            label="systems.grex-id.report.export"
          />
        )}
      </div>

      {/* Charts */}
      {hasChartData && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Classification Pie */}
          <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-6 hover:shadow-lg hover:shadow-[var(--color-light-green)]/10 transition-all">
            <h2 className="text-sm font-semibold text-white mb-4 text-center">
              {t("systems.grex-id.report.chartClassification")}
            </h2>
            <div className="h-64 flex items-center justify-center">
              <Pie
                data={pieData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: {
                      position: "bottom",
                      labels: {
                        color: chartTextColor,
                        padding: 16,
                        usePointStyle: true,
                        pointStyleWidth: 12,
                        font: { size: 12 },
                      },
                    },
                    tooltip: {
                      backgroundColor: "rgba(0,0,0,0.85)",
                      titleColor: "#fff",
                      bodyColor: "#ccc",
                      borderColor: "#333",
                      borderWidth: 1,
                      cornerRadius: 8,
                      padding: 10,
                      callbacks: {
                        label: (ctx) => {
                          const total = (ctx.dataset.data as number[]).reduce(
                            (a, b) => a + b,
                            0,
                          );
                          const pct = total > 0
                            ? ((ctx.raw as number) / total * 100).toFixed(1)
                            : "0";
                          return ` ${ctx.label}: ${ctx.raw} (${pct}%)`;
                        },
                      },
                    },
                  },
                }}
              />
            </div>
            {/* Summary counts */}
            <div className="flex justify-center gap-4 mt-4 text-xs flex-wrap">
              {nonZeroPieCategories.map((c) => (
                <div key={c.key} className="flex items-center gap-1.5">
                  <span className={`w-2.5 h-2.5 rounded-full ${c.dot}`} />
                  <span className="text-[var(--color-light-text)]">
                    {uniqueCounts[c.key]}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Stacked Column: Hourly by Classification */}
          <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-6 hover:shadow-lg hover:shadow-[var(--color-light-green)]/10 transition-all">
            <div className="h-80">
              <Bar
                data={stackedHourData}
                options={stackedBarOptions}
              />
            </div>
          </div>
        </div>
      )}

      <GenericList<DetectionReportItem>
        entityName="systems.grex-id.report.title"
        searchEnabled={false}
        createEnabled={false}
        controlButtons={[]}
        filters={[
          {
            key: "dateRange",
            label: t("systems.grex-id.report.dateRange"),
            component: DateRangeFilter,
            props: { maxRangeDays: 31, mode: "datetime" },
          },
          {
            key: "tagIds",
            label: t("systems.grex-id.report.filterTags"),
            component: MultiBadgeFieldFilter,
            props: {
              fetchFn: fetchTags,
              placeholder: t("common.tags.searchPlaceholder"),
            },
          },
        ]}
        onFiltersChange={setChartFilters}
        fetchFn={fetchIndividuals}
        reloadKey={listReloadKey}
        emptyState={
          <div className="flex flex-col items-center justify-center py-20 gap-6">
            <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-2xl p-8 hover:shadow-lg hover:shadow-[var(--color-light-green)]/10 transition-all">
              <span className="text-8xl">📊</span>
            </div>
            <p className="text-[var(--color-light-text)] text-sm">
              {t("systems.grex-id.report.selectFilters")}
            </p>
          </div>
        }
        renderItem={(item) => {
          const channels = Array.isArray(item.channelIds)
            ? item.channelIds
            : [];
          return (
            <div className="space-y-2">
              <LeadView
                lead={item as LeadViewData}
                systemSlug="grex-id"
              />
              <div className="flex items-center gap-2 text-xs text-[var(--color-light-text)] flex-wrap px-1">
                <ClassificationBadge
                  classification={item.classification}
                  t={t}
                />
                <span>📍 {item.locationName}</span>
                {channels.length > 0 && (
                  <>
                    <span>·</span>
                    {channels.map((ch) => {
                      const icon = ch.type === "email"
                        ? "📧"
                        : ch.type === "phone"
                        ? "📞"
                        : "📡";
                      return (
                        <span
                          key={ch.id}
                          className="inline-flex items-center gap-1"
                        >
                          {icon} {ch.value}
                        </span>
                      );
                    })}
                  </>
                )}
                <span>·</span>
                <DateView
                  mode="datetime"
                  value={item.detectedAt}
                  className="text-xs text-[var(--color-light-text)]"
                />
                <span>·</span>
                <span>
                  {t("systems.grex-id.report.score")}: {item.score.toFixed(2)}
                </span>
              </div>
            </div>
          );
        }}
      />
    </div>
  );
}
