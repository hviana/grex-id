"use client";

import React, { forwardRef, useImperativeHandle, useState } from "react";
import { useLocale } from "@/src/hooks/useLocale";
import type { SubformRef } from "@/src/components/shared/GenericList";
import MultiBadgeField from "@/src/components/fields/MultiBadgeField";
import SearchableSelectField from "@/src/components/fields/SearchableSelectField";
import ResourceLimitsSubform from "@/src/components/subforms/ResourceLimitsSubform";

interface PlanSubformProps {
  initialData?: Record<string, unknown>;
  systems: { id: string; slug: string; name: string }[];
}

const inputCls =
  "w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-2.5 text-white placeholder-white/30 outline-none focus:border-[var(--color-primary-green)] transition-colors";

const PlanSubform = forwardRef<SubformRef, PlanSubformProps>(
  ({ initialData, systems }, ref) => {
    const { t } = useLocale();

    const [name, setName] = useState(
      (initialData?.name as string) ?? "",
    );
    const [description, setDescription] = useState(
      (initialData?.description as string) ?? "",
    );
    const [systemId, setSystemId] = useState(
      (initialData?.systemId as string) ?? (systems[0]?.id ?? ""),
    );
    const [systemSelected, setSystemSelected] = useState<
      { id: string; label: string }[]
    >(() => {
      if (initialData?.systemId) {
        const sys = systems.find(
          (s) => s.id === initialData.systemId,
        );
        return sys ? [{ id: sys.id, label: sys.name }] : [];
      }
      const first = systems[0];
      return first ? [{ id: first.id, label: first.name }] : [];
    });
    const [price, setPrice] = useState(
      String((initialData?.price as number) ?? ""),
    );
    const [currency, setCurrency] = useState(
      (initialData?.currency as string) ?? "USD",
    );
    const [recurrenceDays, setRecurrenceDays] = useState(
      String((initialData?.recurrenceDays as number) ?? 30),
    );
    const [benefits, setBenefits] = useState<string[]>(
      Array.isArray(initialData?.benefits)
        ? [...(initialData.benefits as string[])]
        : [],
    );
    const [isActive, setIsActive] = useState(
      (initialData?.isActive as boolean) ?? true,
    );

    const limitsRef = React.useRef<SubformRef>(null);

    useImperativeHandle(ref, () => ({
      getData: () => {
        const limitsData = limitsRef.current?.getData() ?? {};
        return {
          name,
          description,
          systemId,
          price: Number(price),
          currency,
          recurrenceDays: Number(recurrenceDays),
          benefits,
          isActive,
          ...limitsData,
        };
      },
      isValid: () => {
        if (!name.trim()) return false;
        if (!systemId) return false;
        if (!price && price !== "0") return false;
        if (!recurrenceDays || Number(recurrenceDays) < 1) return false;
        return true;
      },
    }));

    const getSystemSlug = (sysId: string) => {
      const sys = systems.find((s) => s.id === sysId);
      return sys?.slug;
    };

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
              placeholder={t("core.plans.placeholder.name")}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
              {t("core.plans.system")} *
            </label>
            <SearchableSelectField
              fetchFn={async (search: string) => {
                const q = search.toLowerCase();
                return systems
                  .filter((s) =>
                    !q || s.name.toLowerCase().includes(q) ||
                    s.slug.toLowerCase().includes(q)
                  )
                  .map((s) => ({ id: s.id, label: s.name }));
              }}
              showAllOnEmpty
              initialSelected={systemSelected}
              onChange={(items) => {
                const id = items.length > 0 ? items[0].id : "";
                setSystemId(id);
                setSystemSelected(items);
              }}
              placeholder={t("core.plans.selectSystem")}
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
            placeholder={t("core.plans.placeholder.description")}
            className={inputCls}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
              {t("core.plans.price")} * ({t("core.plans.cents")})
            </label>
            <input
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              required
              min="0"
              placeholder={t("core.plans.placeholder.price")}
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
              maxLength={3}
              placeholder={t("core.plans.placeholder.currency")}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
              {t("core.plans.recurrenceDays")} *
            </label>
            <input
              type="number"
              value={recurrenceDays}
              onChange={(e) => setRecurrenceDays(e.target.value)}
              required
              min="1"
              placeholder={t("core.plans.placeholder.recurrenceDays")}
              className={inputCls}
            />
          </div>
        </div>

        <MultiBadgeField
          name={t("core.plans.benefits")}
          mode="custom"
          value={benefits}
          onChange={(vals) => setBenefits(vals as string[])}
          formatHint={t("core.plans.benefitsHint")}
        />

        <ResourceLimitsSubform
          ref={limitsRef}
          mode="plan"
          initialData={initialData}
          systemSlug={getSystemSlug(systemId)}
        />

        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            id="isActive"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="h-4 w-4 rounded border-[var(--color-dark-gray)] accent-[var(--color-primary-green)]"
          />
          <label
            htmlFor="isActive"
            className="text-sm text-[var(--color-light-text)]"
          >
            {t("core.plans.isActive")}
          </label>
        </div>
      </div>
    );
  },
);

PlanSubform.displayName = "PlanSubform";
export default PlanSubform;
