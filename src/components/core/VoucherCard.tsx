"use client";

import { useLocale } from "@/src/hooks/useLocale";
import EditButton from "@/src/components/shared/EditButton";
import DeleteButton from "@/src/components/shared/DeleteButton";
import ResourceLimitsView, {
  type ResourceLimitsData,
} from "@/src/components/shared/ResourceLimitsView";

interface VoucherCardProps {
  voucher: {
    id: string;
    code: string;
    applicablePlanIds: string[];
    resourceLimitId?: ResourceLimitsData | null;
    expiresAt: string | null;
  };
  onEdit: () => void;
  onDelete: () => Promise<void>;
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

      {voucher.resourceLimitId && (
        <ResourceLimitsView
          data={voucher.resourceLimitId}
          modifier
          className="mt-3"
        />
      )}
    </div>
  );
}
