"use client";

import { useLocale } from "@/src/hooks/useLocale";
import EditButton from "@/src/components/shared/EditButton";
import DeleteButton from "@/src/components/shared/DeleteButton";
import TranslatedBadgeList from "@/src/components/shared/TranslatedBadgeList";

interface VoucherCardProps {
  voucher: {
    id: string;
    code: string;
    applicablePlanIds: string[];
    priceModifier: number;
    entityLimitModifiers: Record<string, number> | null;
    apiRateLimitModifier: number;
    storageLimitModifier: number;
    fileCacheLimitModifier: number;
    maxConcurrentDownloadsModifier: number;
    maxConcurrentUploadsModifier: number;
    maxDownloadBandwidthModifier: number;
    maxUploadBandwidthModifier: number;
    maxOperationCountModifier: Record<string, number> | null;
    creditModifier: number;
    expiresAt: string | null;
  };
  onEdit: () => void;
  onDelete: () => Promise<void>;
}

function formatModifier(value: number): string {
  if (value < 0) return `- ${(Math.abs(value) / 100).toFixed(2)}`;
  if (value > 0) return `+ ${(value / 100).toFixed(2)}`;
  return "0";
}

function modifierSpan(label: string, value: number, emoji?: string) {
  if (value === 0) return null;
  return (
    <span>
      {emoji ? `${emoji} ` : ""}
      {label}: {value > 0 ? "+" : ""}
      {value}
    </span>
  );
}

export default function VoucherCard(
  { voucher, onEdit, onDelete }: VoucherCardProps,
) {
  const { t } = useLocale();

  const isExpired = voucher.expiresAt
    ? new Date(voucher.expiresAt) < new Date()
    : false;

  return (
    <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-4 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-[var(--color-light-green)]/10 transition-all">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xl">🎟️</span>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-mono font-semibold text-white text-lg">
                {voucher.code}
              </h3>
              {isExpired && (
                <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-xs text-red-400">
                  {t("core.vouchers.expired")}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3 mt-1 text-sm text-[var(--color-light-text)]">
              <span>
                {t("core.vouchers.priceModifier")}:{" "}
                <span
                  className={voucher.priceModifier < 0
                    ? "text-[var(--color-primary-green)]"
                    : voucher.priceModifier > 0
                    ? "text-red-400"
                    : "text-white"}
                >
                  {formatModifier(voucher.priceModifier)}
                </span>
              </span>
              {modifierSpan(
                t("core.vouchers.apiRate"),
                voucher.apiRateLimitModifier,
              )}
              {voucher.storageLimitModifier !== 0 && (
                <span>
                  {t("core.vouchers.storage")}:{" "}
                  {voucher.storageLimitModifier > 0 ? "+" : ""}
                  {(voucher.storageLimitModifier / 1073741824).toFixed(1)} GB
                </span>
              )}
              {voucher.fileCacheLimitModifier !== 0 && (
                <span>
                  🗂️ {t("core.vouchers.fileCache")}:{" "}
                  {voucher.fileCacheLimitModifier > 0 ? "+" : ""}
                  {(voucher.fileCacheLimitModifier / 1048576).toFixed(1)} MB
                </span>
              )}
              {modifierSpan(
                t("core.vouchers.creditModifier"),
                voucher.creditModifier,
              )}
              {modifierSpan(
                t("core.vouchers.maxConcurrentDownloadsModifier"),
                voucher.maxConcurrentDownloadsModifier,
                "⬇️",
              )}
              {modifierSpan(
                t("core.vouchers.maxConcurrentUploadsModifier"),
                voucher.maxConcurrentUploadsModifier,
                "⬆️",
              )}
              {modifierSpan(
                t("core.vouchers.maxDownloadBandwidthModifier"),
                voucher.maxDownloadBandwidthModifier,
                "📶",
              )}
              {modifierSpan(
                t("core.vouchers.maxUploadBandwidthModifier"),
                voucher.maxUploadBandwidthModifier,
                "📶",
              )}
              {voucher.maxOperationCountModifier &&
                Object.keys(voucher.maxOperationCountModifier).length > 0 &&
                Object.entries(voucher.maxOperationCountModifier).map(
                  ([key, val]) => (
                    <span key={key}>
                      🔢 {t(`billing.limits.${key}`) !== `billing.limits.${key}`
                        ? t(`billing.limits.${key}`)
                        : key}: {val > 0 ? "+" : ""}
                      {val}
                    </span>
                  ),
                )}
              {voucher.applicablePlanIds.length > 0 && (
                <span className="rounded-full bg-[var(--color-secondary-blue)]/20 px-2 py-0.5 text-xs text-[var(--color-secondary-blue)]">
                  {voucher.applicablePlanIds.length}{" "}
                  {t("core.vouchers.applicablePlanIds").toLowerCase()}
                </span>
              )}
              {voucher.expiresAt && !isExpired && (
                <span>
                  {t("core.vouchers.expires")}:{" "}
                  {new Date(voucher.expiresAt).toLocaleDateString()}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex gap-2 ml-3 shrink-0">
          <EditButton onClick={onEdit} />
          <DeleteButton onConfirm={onDelete} />
        </div>
      </div>

      <TranslatedBadgeList
        kind="entity"
        entries={voucher.entityLimitModifiers}
        className="mt-2"
        formatValue={(v) => {
          const n = Number(v);
          return n > 0 ? `+${n}` : String(n);
        }}
      />
    </div>
  );
}
