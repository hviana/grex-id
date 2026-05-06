"use client";

import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { SubformRef } from "@/src/contracts/high-level/components";
import SearchableSelectField from "@/src/components/fields/SearchableSelectField";
import MultiBadgeField from "@/src/components/fields/MultiBadgeField";
import type { BadgeValue } from "@/src/contracts/high-level/components";
import ResourceLimitsSubform from "@/src/components/subforms/ResourceLimitsSubform";
import DateSubForm from "@/src/components/subforms/DateSubForm";
import { useTenantContext } from "@/src/hooks/useTenantContext";
import type { VoucherSubformProps } from "@/src/contracts/high-level/component-props";

const inputCls =
  "w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-2.5 text-white placeholder-white/30 outline-none focus:border-[var(--color-primary-green)] transition-colors";

const VoucherSubform = forwardRef<SubformRef, VoucherSubformProps>(
  ({ initialData }, ref) => {
    const { t } = useTenantContext();
    const { systemToken } = useTenantContext();

    const [name, setName] = useState(
      (initialData?.name as string) ?? "",
    );
    const [priceModifier, setPriceModifier] = useState(
      String((initialData?.priceModifier as number) ?? 0),
    );
    const [applicablePlanIds, setApplicablePlanIds] = useState<
      { id: string; label: string }[]
    >(() => {
      const ids = initialData?.applicablePlanIds as string[] | undefined;
      if (!ids) return [];
      return ids.map((id) => ({ id: String(id), label: String(id) }));
    });
    const [applicableTenantIds, setApplicableCompanyIds] = useState<
      BadgeValue[]
    >(() => {
      const ids = initialData?.applicableTenantIds as string[] | undefined;
      if (!ids) return [];
      return ids.map((id) => ({ id: String(id), name: String(id) }));
    });

    const limitsRef = React.useRef<SubformRef>(null);
    const expiresAtRef = useRef<SubformRef>(null);

    useImperativeHandle(ref, () => ({
      getData: () => {
        const limitsData = limitsRef.current?.getData() ?? {};
        const expiresAtData = expiresAtRef.current?.getData() ?? {};
        // Merge the top-level priceModifier into resourceLimits so it reaches
        // the resource_limit cascade rather than the voucher root row.
        const pm = Number(priceModifier);
        if (pm !== 0 && limitsData.priceModifier === undefined) {
          limitsData.priceModifier = pm;
        }
        return {
          name,
          applicableTenantIds: applicableTenantIds.map((b) =>
            typeof b === "string" ? b : b.id ?? b.name
          ),
          applicablePlanIds: applicablePlanIds.map((p) => p.id),
          expiresAt: expiresAtData.date || null,
          resourceLimits: limitsData,
        };
      },
      isValid: () => !!name.trim(),
    }));

    return (
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
            {t("core.vouchers.name")} *
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder={t("core.vouchers.placeholder.name")}
            className={`${inputCls} font-mono`}
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
              onChange={(e) => setPriceModifier(e.target.value)}
              placeholder="500"
              className={inputCls}
            />
            <p className="mt-1 text-xs text-[var(--color-light-text)]/60">
              {t("core.vouchers.priceModifierHint")}
            </p>
          </div>
          <DateSubForm
            ref={expiresAtRef}
            mode="datetime"
            initialDate={initialData?.expiresAt as string | undefined}
            label={t("core.vouchers.expiresAt")}
          />
        </div>

        <ResourceLimitsSubform
          ref={limitsRef}
          valueMode="modifier"
          initialData={initialData}
        />

        <div>
          <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
            {t("core.vouchers.applicableTenantIds")}
          </label>
          <p className="text-xs text-[var(--color-light-text)]/60 mb-2">
            {t("core.vouchers.applicableCompaniesHint")}
          </p>
          <MultiBadgeField
            name={t("core.vouchers.applicableTenantIds")}
            mode="search"
            value={applicableTenantIds}
            onChange={setApplicableCompanyIds}
            hideLabel
            fetchFn={async (search: string) => {
              const params = new URLSearchParams();
              if (search) params.set("search", search);
              const res = await fetch(`/api/companies?${params}`, {
                headers: { Authorization: `Bearer ${systemToken}` },
              });
              const json = await res.json();
              return (json.items ?? []).map(
                (c: { id: string; name: string }) => ({
                  id: String(c.id),
                  name: c.name,
                }),
              );
            }}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
            {t("core.vouchers.applicablePlanIds")}
          </label>
          <p className="text-xs text-[var(--color-light-text)]/60 mb-2">
            {t("core.vouchers.applicablePlansHint")}
          </p>
          <SearchableSelectField
            fetchFn={async (search: string) => {
              const params = new URLSearchParams();
              if (search) params.set("search", search);
              const res = await fetch(`/api/core/plans?${params}`, {
                headers: { Authorization: `Bearer ${systemToken}` },
              });
              const json = await res.json();
              return (json.items ?? []).map(
                (p: { id: string; name: string }) => ({
                  id: String(p.id),
                  label: p.name,
                }),
              );
            }}
            multiple
            initialSelected={applicablePlanIds}
            onChange={setApplicablePlanIds}
          />
        </div>
      </div>
    );
  },
);

VoucherSubform.displayName = "VoucherSubform";
export default VoucherSubform;
