"use client";

import React, { forwardRef, useImperativeHandle, useState } from "react";
import { useLocale } from "@/src/hooks/useLocale";
import { useAuth } from "@/src/hooks/useAuth";
import type { SubformRef } from "@/src/components/shared/GenericList";
import SearchableSelectField from "@/src/components/fields/SearchableSelectField";
import MultiBadgeField from "@/src/components/fields/MultiBadgeField";
import type { BadgeValue } from "@/src/components/fields/MultiBadgeField";
import ResourceLimitsSubform from "@/src/components/subforms/ResourceLimitsSubform";

interface VoucherSubformProps {
  initialData?: Record<string, unknown>;
}

const inputCls =
  "w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-2.5 text-white placeholder-white/30 outline-none focus:border-[var(--color-primary-green)] transition-colors";

const VoucherSubform = forwardRef<SubformRef, VoucherSubformProps>(
  ({ initialData }, ref) => {
    const { t } = useLocale();
    const { systemToken } = useAuth();

    const [code, setCode] = useState(
      (initialData?.code as string) ?? "",
    );
    const [priceModifier, setPriceModifier] = useState(
      String((initialData?.priceModifier as number) ?? 0),
    );
    const [expiresAt, setExpiresAt] = useState(
      (initialData?.expiresAt as string)?.slice(0, 16) ?? "",
    );
    const [applicablePlans, setApplicablePlans] = useState<
      { id: string; label: string }[]
    >(() => {
      const ids = initialData?.applicablePlans as string[] | undefined;
      if (!ids) return [];
      return ids.map((id) => ({ id: String(id), label: String(id) }));
    });
    const [applicableCompanies, setApplicableCompanies] = useState<
      BadgeValue[]
    >(() => {
      const ids = initialData?.applicableCompanies as string[] | undefined;
      if (!ids) return [];
      return ids.map((id) => String(id));
    });
    const companyMapRef = React.useRef<Map<string, string>>(new Map());

    const limitsRef = React.useRef<SubformRef>(null);

    useImperativeHandle(ref, () => ({
      getData: () => {
        const limitsData = limitsRef.current?.getData() ?? {};
        return {
          code,
          priceModifier: Number(priceModifier),
          applicableCompanies: applicableCompanies.map((v) => {
            const label = typeof v === "string" ? v : v.name;
            return companyMapRef.current.get(label) ?? label;
          }),
          applicablePlans: applicablePlans.map((p) => p.id),
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
          ...limitsData,
        };
      },
      isValid: () => !!code.trim(),
    }));

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
            placeholder={t("core.vouchers.placeholder.code")}
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
        </div>

        <ResourceLimitsSubform
          ref={limitsRef}
          mode="voucher"
          initialData={initialData}
        />

        <div>
          <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
            {t("core.vouchers.applicablePlans")}
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
              return (json.data ?? []).map(
                (p: { id: string; name: string }) => ({
                  id: String(p.id),
                  label: p.name,
                }),
              );
            }}
            multiple
            initialSelected={applicablePlans}
            onChange={setApplicablePlans}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
            {t("core.vouchers.applicableCompanies")}
          </label>
          <p className="text-xs text-[var(--color-light-text)]/60 mb-2">
            {t("core.vouchers.applicableCompaniesHint")}
          </p>
          <MultiBadgeField
            name={t("core.vouchers.applicableCompanies")}
            mode="search"
            value={applicableCompanies}
            onChange={setApplicableCompanies}
            fetchFn={async (search: string) => {
              const params = new URLSearchParams();
              if (search) params.set("search", search);
              params.set("limit", "20");
              const res = await fetch(`/api/core/companies?${params}`, {
                headers: { Authorization: `Bearer ${systemToken}` },
              });
              const json = await res.json();
              return (json.data ?? []).map(
                (c: { id: string; name: string }) => {
                  companyMapRef.current.set(c.name, String(c.id));
                  return c.name;
                },
              );
            }}
            formatHint={t("core.vouchers.placeholder.searchCompanies")}
          />
        </div>
      </div>
    );
  },
);

VoucherSubform.displayName = "VoucherSubform";
export default VoucherSubform;
