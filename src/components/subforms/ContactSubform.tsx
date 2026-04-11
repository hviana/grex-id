"use client";

import { forwardRef, useImperativeHandle, useState } from "react";
import { useLocale } from "@/src/hooks/useLocale";
import { isValidEmail } from "@/src/lib/validators";
import type { SubformRef } from "@/src/components/shared/GenericList";

interface ContactSubformProps {
  initialData?: Record<string, unknown>;
}

const ContactSubform = forwardRef<SubformRef, ContactSubformProps>(
  ({ initialData }, ref) => {
    const { t } = useLocale();

    const [email, setEmail] = useState((initialData?.email as string) ?? "");
    const [phone, setPhone] = useState((initialData?.phone as string) ?? "");

    useImperativeHandle(ref, () => ({
      getData: () => ({
        email,
        phone: phone || undefined,
      }),
      isValid: () => isValidEmail(email),
    }));

    return (
      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
            {t("auth.login.email")} *
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder={t("common.placeholder.email")}
            className="w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-2.5 text-white placeholder-white/30 outline-none focus:border-[var(--color-primary-green)] transition-colors"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
            {t("auth.register.phone")}
          </label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={t("common.placeholder.phone")}
            className="w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-2.5 text-white placeholder-white/30 outline-none focus:border-[var(--color-primary-green)] transition-colors"
          />
        </div>
      </div>
    );
  },
);

ContactSubform.displayName = "ContactSubform";
export default ContactSubform;
