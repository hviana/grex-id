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
    const [creditIncrement, setCreditIncrement] = useState(
      (initialData?.creditIncrement as number) ?? 0,
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
        creditIncrement,
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
              {t("core.vouchers.creditIncrement")}
            </label>
            <input
              type="number"
              value={creditIncrement}
              onChange={(e) => setCreditIncrement(Number(e.target.value))}
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
