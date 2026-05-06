"use client";

import { forwardRef, useImperativeHandle, useState } from "react";
import type { SubformRef } from "@/src/contracts/high-level/components";
import type {
  PaymentMethodSubformProps,
  PaymentMethodSubmitData,
} from "@/src/contracts/high-level/component-props";
import type { CardInput } from "@/src/contracts/high-level/payment-provider";
import type { AddressInput } from "@/src/contracts/high-level/component-props";
import { CreditCardTokenizer } from "@/src/lib/payment/credit-card";
import { useTenantContext } from "@/src/hooks/useTenantContext";
import CreditCardSubform from "./CreditCardSubform";
import AddressSubform from "./AddressSubform";

export interface PaymentMethodSubformRef extends SubformRef {
  submitData(): Promise<PaymentMethodSubmitData>;
}

const PaymentMethodSubform = forwardRef<
  PaymentMethodSubformRef,
  PaymentMethodSubformProps
>(({ initialData, showDefaultToggle = true }, ref) => {
  const { t } = useTenantContext();
  const [type, setType] = useState<string>(
    (initialData?.type as string) ?? "credit_card",
  );
  const [isDefault, setIsDefault] = useState<boolean>(
    (initialData?.isDefault as boolean) ?? false,
  );

  const [creditCardRef, setCreditCardRef] = useState<SubformRef | null>(null);
  const [billingAddressRef, setBillingAddressRef] = useState<SubformRef | null>(
    null,
  );

  useImperativeHandle(ref, () => ({
    getData: () => {
      const cardData = creditCardRef?.getData() ?? {};
      const addressData = billingAddressRef?.getData() ?? {};
      return {
        type,
        isDefault,
        ...cardData,
        ...addressData,
      };
    },
    isValid: () => {
      if (type === "credit_card") {
        return (creditCardRef?.isValid() ?? false) &&
          (billingAddressRef?.isValid() ?? false);
      }
      return false;
    },
    submitData: async () => {
      const raw = creditCardRef?.getData() ?? {};
      const cardInput = (raw.cardData ?? {}) as CardInput;
      const addrRaw = (billingAddressRef?.getData() ?? {}) as Record<
        string,
        unknown
      >;
      const address = (addrRaw.billingAddressId ?? {}) as AddressInput;

      const tokenizer = new CreditCardTokenizer();
      const { cardToken, cardMask } = await tokenizer.tokenize(
        cardInput,
        address,
      );

      return {
        type,
        isDefault,
        cardToken,
        cardMask,
        holderName: cardInput.holderName,
        holderDocument: cardInput.holderDocument,
        billingAddress: address,
      };
    },
  }));

  const inputCls =
    "w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-2.5 text-white outline-none focus:border-[var(--color-primary-green)] transition-colors";
  const labelCls =
    "block text-sm font-medium text-[var(--color-light-text)] mb-1";

  return (
    <div className="space-y-4">
      <div>
        <label className={labelCls}>
          {t("billing.paymentMethods.type")} *
        </label>
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className={inputCls}
        >
          <option value="credit_card" className="bg-[var(--color-black)]">
            💳 {t("billing.paymentMethods.typeCreditCard")}
          </option>
        </select>
      </div>

      {showDefaultToggle && (
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
            className="accent-[var(--color-primary-green)] w-4 h-4"
          />
          <span className="text-sm text-white">
            {t("billing.paymentMethods.default")}
          </span>
        </label>
      )}

      {type === "credit_card" && (
        <>
          <div className="border-t border-[var(--color-dark-gray)] pt-4">
            <h4 className="text-sm font-semibold text-[var(--color-light-text)] mb-3">
              💳 {t("billing.paymentMethods.cardDetails")}
            </h4>
            <CreditCardSubform
              ref={setCreditCardRef}
              initialData={initialData}
            />
          </div>
          <div className="border-t border-[var(--color-dark-gray)] pt-4">
            <h4 className="text-sm font-semibold text-[var(--color-light-text)] mb-3">
              📍 {t("billing.paymentMethods.billingAddress")}
            </h4>
            <AddressSubform
              ref={setBillingAddressRef}
              initialData={initialData}
            />
          </div>
        </>
      )}
    </div>
  );
});

PaymentMethodSubform.displayName = "PaymentMethodSubform";
export default PaymentMethodSubform;
