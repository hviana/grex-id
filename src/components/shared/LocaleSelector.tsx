"use client";
import { useTenantContext } from "@/src/hooks/useTenantContext";

export default function LocaleSelector() {
  const { locale, setLocale, t, supportedLocales } = useTenantContext();

  return (
    <select
      value={locale}
      onChange={(e) => setLocale(e.target.value as typeof locale)}
      className="bg-transparent text-sm text-[var(--color-light-text)] border border-[var(--color-dark-gray)] rounded px-2 py-1 outline-none focus:border-[var(--color-primary-green)] cursor-pointer"
      aria-label={t("common.locale.selector")}
    >
      {supportedLocales.map((loc) => (
        <option key={loc} value={loc} className="bg-[var(--color-black)]">
          {t(`common.locale.${loc}`)}
        </option>
      ))}
    </select>
  );
}
