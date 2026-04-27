"use client";

import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { SubformRef } from "@/src/components/shared/GenericList";
import ResourceLimitsSubform from "@/src/components/subforms/ResourceLimitsSubform";
import TenantSubform from "@/src/components/subforms/TenantSubform";
import { useTenantContext } from "@/src/hooks/useTenantContext";

interface PlanSubformProps {
  initialData?: Record<string, unknown>;
}

const inputCls =
  "w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-2.5 text-white placeholder-white/30 outline-none focus:border-[var(--color-primary-green)] transition-colors";

const PlanSubform = forwardRef<SubformRef, PlanSubformProps>(
  ({ initialData }, ref) => {
    const { t } = useTenantContext();

    const [name, setName] = useState(
      (initialData?.name as string) ?? "",
    );
    const [description, setDescription] = useState(
      (initialData?.description as string) ?? "",
    );
    const [price, setPrice] = useState(
      String((initialData?.price as number) ?? ""),
    );
    const [currency, setCurrency] = useState(
      (initialData?.currency as string) ?? "USD",
    );
    const [recurrenceDays, setRecurrenceDays] = useState(
      String((initialData?.recurrenceDays as number) ?? 30),
    );
    const [isActive, setIsActive] = useState(
      (initialData?.isActive as boolean) ?? true,
    );

    const tenantRef = useRef<SubformRef>(null);
    const limitsRef = React.useRef<SubformRef>(null);

    useImperativeHandle(ref, () => ({
      getData: () => {
        const tenantData = tenantRef.current?.getData() ?? {};
        const limitsData = limitsRef.current?.getData() ?? {};
        return {
          name,
          description,
          systemId: tenantData.systemId ?? "",
          price: Number(price),
          currency,
          recurrenceDays: Number(recurrenceDays),
          isActive,
          resourceLimits: limitsData,
        };
      },
      isValid: () => {
        if (!name.trim()) return false;
        if (!tenantRef.current?.isValid()) return false;
        if (!price && price !== "0") return false;
        if (!recurrenceDays || Number(recurrenceDays) < 1) return false;
        return true;
      },
    }));

    return (
      <div className="space-y-4">
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

        <TenantSubform
          ref={tenantRef}
          visibleFields={["systemId"]}
          requiredFields={["systemId"]}
          initialData={{
            systemId: (initialData?.systemId as string) ?? "",
            systemSlug: (initialData?.systemSlug as string) ?? "",
          }}
        />

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

        <ResourceLimitsSubform
          ref={limitsRef}
          valueMode="absolute"
          initialData={initialData}
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
