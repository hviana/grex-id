"use client";

import { forwardRef, useImperativeHandle, useState } from "react";
import type { SubformRef } from "@/src/components/shared/GenericList";
import { useTenantContext } from "@/src/hooks/useTenantContext";

interface CreditCardSubformProps {
  initialData?: Record<string, unknown>;
}

const CreditCardSubform = forwardRef<SubformRef, CreditCardSubformProps>(
  ({ initialData }, ref) => {
    const { t } = useTenantContext();

    const [number, setNumber] = useState("");
    const [cvv, setCvv] = useState("");
    const [expiryMonth, setExpiryMonth] = useState("");
    const [expiryYear, setExpiryYear] = useState("");
    const [holderName, setHolderName] = useState(
      (initialData?.holderName as string) ?? "",
    );
    const [holderDocument, setHolderDocument] = useState(
      (initialData?.holderDocument as string) ?? "",
    );

    useImperativeHandle(ref, () => ({
      getData: () => ({
        cardData: {
          number,
          cvv,
          expiryMonth,
          expiryYear,
          holderName,
          holderDocument,
        },
      }),
      isValid: () =>
        number.replace(/\s/g, "").length >= 13 &&
        cvv.length >= 3 &&
        expiryMonth.length === 2 &&
        expiryYear.length >= 2 &&
        holderName.trim().length > 0 &&
        holderDocument.trim().length > 0,
    }));

    const inputCls =
      "w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-2.5 text-white outline-none focus:border-[var(--color-primary-green)] transition-colors placeholder-white/30";
    const labelCls =
      "block text-sm font-medium text-[var(--color-light-text)] mb-1";

    return (
      <div className="space-y-3">
        <div>
          <label className={labelCls}>{t("billing.card.number")} *</label>
          <input
            type="text"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            maxLength={19}
            placeholder={t("billing.card.numberPlaceholder")}
            required
            className={inputCls}
          />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>{t("billing.card.expiry")} *</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={expiryMonth}
                onChange={(e) => setExpiryMonth(e.target.value)}
                maxLength={2}
                placeholder={t("billing.card.monthPlaceholder")}
                className={inputCls}
              />
              <input
                type="text"
                value={expiryYear}
                onChange={(e) => setExpiryYear(e.target.value)}
                maxLength={4}
                placeholder={t("billing.card.yearPlaceholder")}
                className={inputCls}
              />
            </div>
          </div>
          <div>
            <label className={labelCls}>{t("billing.card.cvv")} *</label>
            <input
              type="text"
              value={cvv}
              onChange={(e) => setCvv(e.target.value)}
              maxLength={4}
              placeholder={t("billing.card.cvvPlaceholder")}
              className={inputCls}
            />
          </div>
        </div>
        <div>
          <label className={labelCls}>{t("billing.card.holder")} *</label>
          <input
            type="text"
            value={holderName}
            onChange={(e) => setHolderName(e.target.value)}
            required
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>{t("billing.card.document")} *</label>
          <input
            type="text"
            value={holderDocument}
            onChange={(e) => setHolderDocument(e.target.value)}
            required
            className={inputCls}
          />
        </div>
      </div>
    );
  },
);

CreditCardSubform.displayName = "CreditCardSubform";
export default CreditCardSubform;
