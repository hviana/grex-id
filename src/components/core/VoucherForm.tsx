"use client";

import { forwardRef, useImperativeHandle, useState } from "react";
import { useLocale } from "@/src/hooks/useLocale";
import type { SubformRef } from "@/src/components/shared/GenericList";
import MultiBadgeField from "@/src/components/fields/MultiBadgeField";

interface VoucherFormProps {
  initialData?: Record<string, unknown>;
}

const VoucherForm = forwardRef<SubformRef, VoucherFormProps>(
  ({ initialData }, ref) => {
    const { t } = useLocale();
    const [code, setCode] = useState((initialData?.code as string) ?? "");
    const [priceModifier, setPriceModifier] = useState(
      (initialData?.priceModifier as number) ?? 0,
    );
    const [apiRateLimitModifier, setApiRateLimitModifier] = useState(
      (initialData?.apiRateLimitModifier as number) ?? 0,
    );
    const [storageLimitModifier, setStorageLimitModifier] = useState(
      (initialData?.storageLimitModifier as number) ?? 0,
    );
    const [maxConcurrentDownloadsModifier, setMaxConcurrentDownloadsModifier] =
      useState(
        (initialData?.maxConcurrentDownloadsModifier as number) ?? 0,
      );
    const [maxConcurrentUploadsModifier, setMaxConcurrentUploadsModifier] =
      useState(
        (initialData?.maxConcurrentUploadsModifier as number) ?? 0,
      );
    const [maxDownloadBandwidthModifier, setMaxDownloadBandwidthModifier] =
      useState(
        (initialData?.maxDownloadBandwidthModifier as number) ?? 0,
      );
    const [maxUploadBandwidthModifier, setMaxUploadBandwidthModifier] =
      useState(
        (initialData?.maxUploadBandwidthModifier as number) ?? 0,
      );
    const [maxOperationCountModifier, setMaxOperationCountModifier] = useState(
      (initialData?.maxOperationCountModifier as number) ?? 0,
    );
    const [creditModifier, setCreditModifier] = useState(
      (initialData?.creditModifier as number) ?? 0,
    );
    const [expiresAt, setExpiresAt] = useState(
      (initialData?.expiresAt as string) ?? "",
    );
    const [permissions, setPermissions] = useState<string[]>(
      (initialData?.permissions as string[]) ?? [],
    );

    useImperativeHandle(ref, () => ({
      getData: () => ({
        code,
        priceModifier,
        apiRateLimitModifier,
        storageLimitModifier,
        maxConcurrentDownloadsModifier,
        maxConcurrentUploadsModifier,
        maxDownloadBandwidthModifier,
        maxUploadBandwidthModifier,
        maxOperationCountModifier,
        creditModifier,
        expiresAt: expiresAt || undefined,
        permissions,
      }),
      isValid: () => code.trim().length > 0,
    }));

    const inputCls =
      "w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-2.5 text-white placeholder-white/30 outline-none focus:border-[var(--color-primary-green)] transition-colors";

    return (
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
            {t("core.vouchers.code")} *
          </label>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
            className={inputCls}
            placeholder={t("core.vouchers.placeholder.code")}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
              {t("core.vouchers.priceModifier")} ({t("core.vouchers.cents")})
            </label>
            <input
              type="number"
              value={priceModifier}
              onChange={(e) => setPriceModifier(Number(e.target.value))}
              className={inputCls}
            />
            <p className="text-xs text-[var(--color-light-text)] mt-1">
              {t("core.vouchers.priceModifierHint")}
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
              {t("core.vouchers.creditModifier")}
            </label>
            <input
              type="number"
              value={creditModifier}
              onChange={(e) => setCreditModifier(Number(e.target.value))}
              className={inputCls}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
              {t("core.vouchers.apiRateLimitModifier")}
            </label>
            <input
              type="number"
              value={apiRateLimitModifier}
              onChange={(e) => setApiRateLimitModifier(Number(e.target.value))}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
              {t("core.vouchers.storageLimitModifier")}
            </label>
            <input
              type="number"
              value={storageLimitModifier}
              onChange={(e) => setStorageLimitModifier(Number(e.target.value))}
              className={inputCls}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
              {t("core.vouchers.maxConcurrentDownloadsModifier")}
            </label>
            <input
              type="number"
              value={maxConcurrentDownloadsModifier}
              onChange={(e) =>
                setMaxConcurrentDownloadsModifier(Number(e.target.value))}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
              {t("core.vouchers.maxConcurrentUploadsModifier")}
            </label>
            <input
              type="number"
              value={maxConcurrentUploadsModifier}
              onChange={(e) =>
                setMaxConcurrentUploadsModifier(Number(e.target.value))}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
              {t("core.vouchers.maxOperationCountModifier")}
            </label>
            <input
              type="number"
              value={maxOperationCountModifier}
              onChange={(e) =>
                setMaxOperationCountModifier(Number(e.target.value))}
              className={inputCls}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
              {t("core.vouchers.maxDownloadBandwidthModifier")}
            </label>
            <input
              type="number"
              value={maxDownloadBandwidthModifier}
              onChange={(e) =>
                setMaxDownloadBandwidthModifier(Number(e.target.value))}
              step="0.1"
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
              {t("core.vouchers.maxUploadBandwidthModifier")}
            </label>
            <input
              type="number"
              value={maxUploadBandwidthModifier}
              onChange={(e) =>
                setMaxUploadBandwidthModifier(Number(e.target.value))}
              step="0.1"
              className={inputCls}
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
            {t("core.vouchers.expiresAt")}
          </label>
          <input
            type="datetime-local"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            className={inputCls}
          />
        </div>

        <MultiBadgeField
          name={t("core.vouchers.permissions")}
          mode="custom"
          value={permissions}
          onChange={(vals) => setPermissions(vals as string[])}
        />
      </div>
    );
  },
);

VoucherForm.displayName = "VoucherForm";
export default VoucherForm;
