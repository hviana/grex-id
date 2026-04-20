"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useLocale } from "@/src/hooks/useLocale";
import { useAuth } from "@/src/hooks/useAuth";
import { useSystemContext } from "@/src/hooks/useSystemContext";
import DateRangeFilter from "@/src/components/shared/DateRangeFilter";
import Spinner from "@/src/components/shared/Spinner";
import DownloadData from "@/src/components/shared/DownloadData";
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

ChartJS.register(
  ArcElement,
  BarElement,
  CategoryScale,
  LinearScale,
  Title,
  Tooltip,
  Legend,
);

const DAY_KEYS = [
  "systems.grex-id.report.sunday",
  "systems.grex-id.report.monday",
  "systems.grex-id.report.tuesday",
  "systems.grex-id.report.wednesday",
  "systems.grex-id.report.thursday",
  "systems.grex-id.report.friday",
  "systems.grex-id.report.saturday",
];

interface DetectionIndividual {
  faceId: string;
  leadId?: string;
  leadName?: string;
  leadEmail?: string;
  leadPhone?: string;
  leadAvatarUri?: string;
  classification: "member" | "visitor" | "unknown";
  detectionCount: number;
  lastDetectedAt: string;
  bestScore: number;
  locationId: string;
  locationName: string;
  ownerId?: string;
  ownerName?: string;
}

interface DetectionStats {
  uniqueMembers: number;
  uniqueVisitors: number;
  uniqueUnknowns: number;
  individuals: DetectionIndividual[];
  hourlyUnique: number[];
  dailyUnique: number[];
}

function formatDate(iso: string, locale: string): string {
  try {
    return new Date(iso).toLocaleString(
      locale === "pt-BR" ? "pt-BR" : "en-US",
      {
        dateStyle: "short",
        timeStyle: "short",
      },
    );
  } catch {
    return iso;
  }
}

function getWhatsAppUrl(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return `https://wa.me/${digits}`;
}

function ClassificationBadge(
  { classification, t }: { classification: string; t: (k: string) => string },
) {
  const styles: Record<string, string> = {
    member:
      "bg-[var(--color-primary-green)]/10 text-[var(--color-primary-green)] border-[var(--color-primary-green)]/30",
    visitor: "bg-yellow-500/10 text-yellow-400 border-yellow-400/30",
    unknown: "bg-red-500/10 text-red-400 border-red-400/30",
  };
  const labels: Record<string, string> = {
    member: t("systems.grex-id.report.member"),
    visitor: t("systems.grex-id.report.visitor"),
    unknown: t("systems.grex-id.report.unknown"),
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
  const { t, locale } = useLocale();
  const { systemToken } = useAuth();
  const { companyId, systemId } = useSystemContext();
  const [stats, setStats] = useState<DetectionStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [dateRange, setDateRange] = useState<
    {
      start: string;
      end: string;
    } | null
  >(null);

  const fetchStats = useCallback(
    async () => {
      if (!dateRange || !companyId || !systemId || !systemToken) return;
      setLoading(true);
      try {
        const qs = new URLSearchParams({
          action: "stats",
          startDate: dateRange.start,
          endDate: dateRange.end,
          companyId,
          systemId,
        });

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
    [dateRange, companyId, systemId, systemToken],
  );

  useEffect(() => {
    if (dateRange) {
      fetchStats();
    }
  }, [fetchStats]);

  const handleDateChange = (start: Date, end: Date) => {
    setDateRange({
      start: start.toISOString(),
      end: end.toISOString(),
    });
  };

  const individuals = stats?.individuals ?? [];
  const uniqueCounts = useMemo(
    () => ({
      member: stats?.uniqueMembers ?? 0,
      visitor: stats?.uniqueVisitors ?? 0,
      unknown: stats?.uniqueUnknowns ?? 0,
    }),
    [stats],
  );

  const pieData = useMemo(
    () => ({
      labels: [
        t("systems.grex-id.report.member"),
        t("systems.grex-id.report.visitor"),
        t("systems.grex-id.report.unknown"),
      ],
      datasets: [
        {
          data: [
            uniqueCounts.member,
            uniqueCounts.visitor,
            uniqueCounts.unknown,
          ],
          backgroundColor: [
            "rgba(2, 208, 125, 0.75)",
            "rgba(234, 179, 8, 0.75)",
            "rgba(239, 68, 68, 0.75)",
          ],
          borderColor: [
            "#02d07d",
            "#eab308",
            "#ef4444",
          ],
          borderWidth: 2,
          hoverOffset: 8,
        },
      ],
    }),
    [uniqueCounts, t],
  );

  const hourLabels = useMemo(
    () =>
      Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}:00`),
    [],
  );

  const hourData = useMemo(
    () => ({
      labels: hourLabels,
      datasets: [
        {
          label: t("systems.grex-id.report.uniqueIndividuals"),
          data: stats?.hourlyUnique ?? new Array(24).fill(0),
          backgroundColor: "rgba(0, 204, 255, 0.6)",
          borderColor: "#00ccff",
          borderWidth: 1,
          borderRadius: 4,
          hoverBackgroundColor: "rgba(0, 204, 255, 0.85)",
        },
      ],
    }),
    [stats?.hourlyUnique, hourLabels, t],
  );

  const dayOfWeekData = useMemo(
    () => ({
      labels: DAY_KEYS.map((k) => t(k)),
      datasets: [
        {
          label: t("systems.grex-id.report.uniqueIndividuals"),
          data: stats?.dailyUnique ?? new Array(7).fill(0),
          backgroundColor: [
            "rgba(2, 208, 125, 0.6)",
            "rgba(0, 204, 255, 0.6)",
            "rgba(153, 102, 255, 0.6)",
            "rgba(255, 159, 64, 0.6)",
            "rgba(255, 99, 132, 0.6)",
            "rgba(75, 192, 192, 0.6)",
            "rgba(255, 206, 86, 0.6)",
          ],
          borderColor: [
            "#02d07d",
            "#00ccff",
            "#9966ff",
            "#ff9f40",
            "#ff6384",
            "#4bc0c0",
            "#ffce56",
          ],
          borderWidth: 1,
          borderRadius: 4,
          hoverBackgroundColor: [
            "rgba(2, 208, 125, 0.85)",
            "rgba(0, 204, 255, 0.85)",
            "rgba(153, 102, 255, 0.85)",
            "rgba(255, 159, 64, 0.85)",
            "rgba(255, 99, 132, 0.85)",
            "rgba(75, 192, 192, 0.85)",
            "rgba(255, 206, 86, 0.85)",
          ],
        },
      ],
    }),
    [stats?.dailyUnique, t],
  );

  const chartTextColor = "#cccccc";
  const chartGridColor = "rgba(51, 51, 51, 0.4)";

  const barOptions = (titleKey: string) => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      title: {
        display: true,
        text: t(titleKey),
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
        ticks: { color: chartTextColor, font: { size: 11 } },
        grid: { color: chartGridColor },
      },
      y: {
        beginAtZero: true,
        ticks: {
          color: chartTextColor,
          stepSize: 1,
          precision: 0,
        },
        grid: { color: chartGridColor },
      },
    },
  });

  const exportData = useCallback(async () => {
    return individuals.map((item) => ({
      [t("systems.grex-id.report.exportId")]: item.classification === "member"
        ? item.leadId ?? item.faceId
        : item.faceId,
      [t("systems.grex-id.report.exportClassification")]: t(
        `systems.grex-id.report.${item.classification}`,
      ),
      [t("systems.grex-id.report.exportName")]: item.leadName ??
        t("systems.grex-id.report.unknownPerson"),
      [t("systems.grex-id.report.exportDetectionCount")]: item.detectionCount,
      [t("systems.grex-id.report.exportLocation")]: item.locationName,
      [t("systems.grex-id.report.exportDate")]: formatDate(
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
              dateRange?.start?.slice(0, 10) ?? ""
            }`}
            sheetName={t("systems.grex-id.report.title")}
            label="systems.grex-id.report.export"
          />
        )}
      </div>

      <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-4">
        <label className="block text-sm font-medium text-[var(--color-light-text)] mb-2">
          {t("systems.grex-id.report.dateRange")}
        </label>
        <DateRangeFilter maxRangeDays={31} onChange={handleDateChange} />
      </div>

      {/* Charts */}
      {hasChartData && (
        <div className="space-y-6">
          {/* Row 1: Pie + Time of Day */}
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
              <div className="flex justify-center gap-6 mt-4 text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[var(--color-primary-green)]" />
                  <span className="text-[var(--color-light-text)]">
                    {uniqueCounts.member}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-yellow-500" />
                  <span className="text-[var(--color-light-text)]">
                    {uniqueCounts.visitor}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
                  <span className="text-[var(--color-light-text)]">
                    {uniqueCounts.unknown}
                  </span>
                </div>
              </div>
            </div>

            {/* Unique individuals by Time of Day */}
            <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-6 hover:shadow-lg hover:shadow-[var(--color-light-green)]/10 transition-all">
              <div className="h-80">
                <Bar
                  data={hourData}
                  options={barOptions("systems.grex-id.report.chartByHour")}
                />
              </div>
            </div>
          </div>

          {/* Row 2: Day of Week */}
          <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-6 hover:shadow-lg hover:shadow-[var(--color-light-green)]/10 transition-all">
            <div className="h-72">
              <Bar
                data={dayOfWeekData}
                options={barOptions("systems.grex-id.report.chartByDay")}
              />
            </div>
          </div>
        </div>
      )}

      {!dateRange && !loading && (
        <div className="text-center py-12 text-[var(--color-light-text)]">
          {t("systems.grex-id.report.selectDates")}
        </div>
      )}

      {loading && (
        <div className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      )}

      {individuals.length > 0 && (
        <div className="space-y-3">
          {individuals.map((item) => (
            <div
              key={item.faceId}
              className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-4 hover:-translate-y-1 hover:shadow-lg hover:shadow-[var(--color-light-green)]/20 transition-all duration-300"
            >
              <div className="flex items-start gap-4">
                {/* Avatar */}
                <div className="flex-shrink-0">
                  {item.leadAvatarUri
                    ? (
                      <Image
                        src={`/api/files/download?uri=${
                          encodeURIComponent(item.leadAvatarUri)
                        }`}
                        alt={item.leadName ??
                          t("systems.grex-id.report.unknownPerson")}
                        width={56}
                        height={56}
                        unoptimized
                        className="w-14 h-14 rounded-full object-cover border-2 border-[var(--color-primary-green)]/30"
                      />
                    )
                    : (
                      <div className="w-14 h-14 rounded-full bg-gradient-to-br from-[var(--color-primary-green)]/20 to-[var(--color-secondary-blue)]/20 flex items-center justify-center text-2xl border border-[var(--color-dark-gray)]">
                        {item.classification === "unknown" ? "❓" : "👤"}
                      </div>
                    )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-white font-semibold text-sm">
                      {item.leadName ??
                        t("systems.grex-id.report.unknownPerson")}
                    </h3>
                    <ClassificationBadge
                      classification={item.classification}
                      t={t}
                    />
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--color-secondary-blue)]/10 text-[var(--color-secondary-blue)] border border-[var(--color-secondary-blue)]/30">
                      {t("systems.grex-id.report.detectionCount")}:{" "}
                      {item.detectionCount}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-xs text-[var(--color-light-text)]">
                    <span>📍 {item.locationName}</span>
                    <span>·</span>
                    <span>{formatDate(item.lastDetectedAt, locale)}</span>
                  </div>

                  <div className="flex items-center gap-2 text-xs text-[var(--color-light-text)]">
                    <span>
                      {t("systems.grex-id.report.faceId")}:{" "}
                      <span className="font-mono">
                        {item.classification === "member"
                          ? item.leadId ?? item.faceId
                          : item.faceId}
                      </span>
                    </span>
                  </div>

                  {item.ownerName && (
                    <p className="text-xs text-[var(--color-secondary-blue)]">
                      👑 {t("systems.grex-id.report.owner")}: {item.ownerName}
                    </p>
                  )}

                  {item.classification === "member" && (
                    <div className="flex items-center gap-3 mt-2">
                      {item.leadEmail && (
                        <a
                          href={`mailto:${item.leadEmail}`}
                          className="text-xs text-[var(--color-secondary-blue)] hover:text-white transition-colors"
                        >
                          ✉ {item.leadEmail}
                        </a>
                      )}
                      {item.leadPhone && (
                        <a
                          href={getWhatsAppUrl(item.leadPhone)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded-full bg-[var(--color-primary-green)]/10 border border-[var(--color-primary-green)]/30 px-3 py-1 text-xs font-medium text-[var(--color-primary-green)] hover:bg-[var(--color-primary-green)]/20 transition-colors"
                        >
                          💬 WhatsApp
                        </a>
                      )}
                    </div>
                  )}

                  {item.classification === "visitor" && (
                    <p className="text-xs text-yellow-400/70 italic">
                      {t("systems.grex-id.report.visitorNote")}
                    </p>
                  )}
                </div>

                {/* Score */}
                <div className="text-right flex-shrink-0">
                  <span className="text-xs text-[var(--color-light-text)]">
                    {t("systems.grex-id.report.score")}
                  </span>
                  <p className="text-sm font-mono text-white">
                    {item.bestScore.toFixed(2)}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {dateRange && !loading && individuals.length === 0 && (
        <div className="text-center py-12 text-[var(--color-light-text)]">
          {t("common.noResults")}
        </div>
      )}
    </div>
  );
}
