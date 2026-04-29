"use client";

import { forwardRef, useImperativeHandle, useState } from "react";
import type { SubformRef } from "@/src/contracts/high_level/components";
import { useTenantContext } from "@/src/hooks/useTenantContext";

interface AddressSubformProps {
  initialData?: Record<string, unknown>;
  fieldPrefix?: string;
}

const AddressSubform = forwardRef<SubformRef, AddressSubformProps>(
  ({ initialData, fieldPrefix = "billingAddressId" }, ref) => {
    const { t } = useTenantContext();
    const addr = (initialData?.[fieldPrefix] as Record<string, string>) ?? {};

    const [street, setStreet] = useState(addr.street ?? "");
    const [number, setNumber] = useState(addr.number ?? "");
    const [complement, setComplement] = useState(addr.complement ?? "");
    const [neighborhood, setNeighborhood] = useState(addr.neighborhood ?? "");
    const [city, setCity] = useState(addr.city ?? "");
    const [state, setState] = useState(addr.state ?? "");
    const [country, setCountry] = useState(addr.country ?? "");
    const [postalCode, setPostalCode] = useState(addr.postalCode ?? "");

    useImperativeHandle(ref, () => ({
      getData: () => ({
        [fieldPrefix]: {
          street,
          number,
          ...(complement ? { complement } : {}),
          ...(neighborhood ? { neighborhood } : {}),
          city,
          state,
          country,
          postalCode,
        },
      }),
      isValid: () =>
        street.trim().length > 0 &&
        number.trim().length > 0 &&
        city.trim().length > 0 &&
        state.trim().length > 0 &&
        country.trim().length > 0 &&
        postalCode.trim().length > 0,
    }));

    const inputCls =
      "w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-2.5 text-white outline-none focus:border-[var(--color-primary-green)] transition-colors";
    const labelCls =
      "block text-sm font-medium text-[var(--color-light-text)] mb-1";

    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 sm:col-span-1">
            <label className={labelCls}>{t("common.address.street")} *</label>
            <input
              type="text"
              value={street}
              onChange={(e) => setStreet(e.target.value)}
              required
              placeholder={t("common.placeholder.street")}
              className={`${inputCls} placeholder-white/30`}
            />
          </div>
          <div>
            <label className={labelCls}>{t("common.address.number")} *</label>
            <input
              type="text"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              required
              placeholder={t("common.placeholder.number")}
              className={`${inputCls} placeholder-white/30`}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>{t("common.address.complement")}</label>
            <input
              type="text"
              value={complement}
              onChange={(e) => setComplement(e.target.value)}
              placeholder={t("common.placeholder.complement")}
              className={`${inputCls} placeholder-white/30`}
            />
          </div>
          <div>
            <label className={labelCls}>
              {t("common.address.neighborhood")}
            </label>
            <input
              type="text"
              value={neighborhood}
              onChange={(e) => setNeighborhood(e.target.value)}
              placeholder={t("common.placeholder.neighborhood")}
              className={`${inputCls} placeholder-white/30`}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>{t("common.address.city")} *</label>
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              required
              placeholder={t("common.placeholder.city")}
              className={`${inputCls} placeholder-white/30`}
            />
          </div>
          <div>
            <label className={labelCls}>{t("common.address.state")} *</label>
            <input
              type="text"
              value={state}
              onChange={(e) => setState(e.target.value)}
              required
              placeholder={t("common.placeholder.state")}
              className={`${inputCls} placeholder-white/30`}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>{t("common.address.country")} *</label>
            <input
              type="text"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              required
              placeholder={t("common.placeholder.country")}
              className={`${inputCls} placeholder-white/30`}
            />
          </div>
          <div>
            <label className={labelCls}>
              {t("common.address.postalCode")} *
            </label>
            <input
              type="text"
              value={postalCode}
              onChange={(e) => setPostalCode(e.target.value)}
              required
              placeholder={t("common.placeholder.postalCode")}
              className={`${inputCls} placeholder-white/30`}
            />
          </div>
        </div>
      </div>
    );
  },
);

AddressSubform.displayName = "AddressSubform";
export default AddressSubform;
