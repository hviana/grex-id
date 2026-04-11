"use client";

import { forwardRef, useImperativeHandle, useState } from "react";
import { useLocale } from "@/src/hooks/useLocale";
import type { SubformRef } from "@/src/components/shared/GenericList";
import MultiBadgeField from "@/src/components/fields/MultiBadgeField";

interface PlanFormProps {
  initialData?: Record<string, unknown>;
}

const PlanForm = forwardRef<SubformRef, PlanFormProps>(
  ({ initialData }, ref) => {
    const { t } = useLocale();
    const [name, setName] = useState((initialData?.name as string) ?? "");
    const [description, setDescription] = useState(
      (initialData?.description as string) ?? "",
    );
    const [systemId, setSystemId] = useState(
      (initialData?.systemId as string) ?? "",
    );
    const [price, setPrice] = useState((initialData?.price as number) ?? 0);
    const [currency, setCurrency] = useState(
      (initialData?.currency as string) ?? "USD",
    );
    const [recurrenceDays, setRecurrenceDays] = useState(
      (initialData?.recurrenceDays as number) ?? 30,
    );
    const [apiRateLimit, setApiRateLimit] = useState(
      (initialData?.apiRateLimit as number) ?? 1000,
    );
    const [storageLimitBytes, setStorageLimitBytes] = useState(
      (initialData?.storageLimitBytes as number) ?? 1073741824,
    );
    const [planCredits, setPlanCredits] = useState(
      (initialData?.planCredits as number) ?? 0,
    );
    const [isActive, setIsActive] = useState(
      (initialData?.isActive as boolean) ?? true,
    );
    const [benefits, setBenefits] = useState<string[]>(
      (initialData?.benefits as string[]) ?? [],
    );
    const [permissions, setPermissions] = useState<string[]>(
      (initialData?.permissions as string[]) ?? [],
    );

    useImperativeHandle(ref, () => ({
      getData: () => ({
        name,
        description,
        systemId,
        price,
        currency,
        recurrenceDays,
        apiRateLimit,
        storageLimitBytes,
        planCredits,
        isActive,
        benefits,
        permissions,
      }),
      isValid: () =>
        name.trim().length > 0 && systemId.trim().length > 0 && price >= 0,
    }));

    const inputCls =
      "w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-2.5 text-white outline-none focus:border-[var(--color-primary-green)] transition-colors";

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
              {t("core.plans.name")} *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className={inputCls}
              placeholder="plans.pro.name"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
              {t("core.plans.system")} *
            </label>
            <input
              type="text"
              value={systemId}
              onChange={(e) => setSystemId(e.target.value)}
              required
              className={inputCls}
              placeholder="system:..."
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
            {t("core.plans.description")}
          </label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={inputCls}
            placeholder="plans.pro.description"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
              {t("core.plans.price")} ({t("core.plans.cents")}) *
            </label>
            <input
              type="number"
              value={price}
              onChange={(e) => setPrice(Number(e.target.value))}
              min={0}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
              {t("core.plans.currency")}
            </label>
            <input
              type="text"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className={inputCls}
              placeholder="USD"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
              {t("core.plans.recurrenceDays")}
            </label>
            <input
              type="number"
              value={recurrenceDays}
              onChange={(e) => setRecurrenceDays(Number(e.target.value))}
              min={1}
              className={inputCls}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
              {t("core.plans.apiRateLimit")}
            </label>
            <input
              type="number"
              value={apiRateLimit}
              onChange={(e) => setApiRateLimit(Number(e.target.value))}
              min={1}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
              {t("core.plans.storageLimitBytes")}
            </label>
            <input
              type="number"
              value={storageLimitBytes}
              onChange={(e) => setStorageLimitBytes(Number(e.target.value))}
              min={0}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
              {t("core.plans.planCredits")} ({t("core.plans.cents")})
            </label>
            <input
              type="number"
              value={planCredits}
              onChange={(e) => setPlanCredits(Number(e.target.value))}
              min={0}
              className={inputCls}
            />
          </div>
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="w-4 h-4 accent-[var(--color-primary-green)]"
          />
          <span className="text-sm text-[var(--color-light-text)]">
            {t("core.plans.isActive")}
          </span>
        </label>

        <MultiBadgeField
          name={t("core.plans.benefits")}
          mode="custom"
          value={benefits}
          onChange={(vals) => setBenefits(vals as string[])}
          formatHint={t("core.plans.benefitsHint")}
        />

        <MultiBadgeField
          name={t("core.plans.permissions")}
          mode="custom"
          value={permissions}
          onChange={(vals) => setPermissions(vals as string[])}
        />
      </div>
    );
  },
);

PlanForm.displayName = "PlanForm";
export default PlanForm;
