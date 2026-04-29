import enCommon from "./en/common.json";
import enAuth from "./en/auth.json";
import enCore from "./en/core.json";
import enBilling from "./en/billing.json";
import enHomepage from "./en/homepage.json";
import enTemplates from "./en/templates.json";
import enValidation from "./en/validation.json";
import enRoles from "./en/roles.json";
import enEntities from "./en/entities.json";
import enResources from "./en/resources.json";
import ptBRCommon from "./pt-BR/common.json";
import ptBRAuth from "./pt-BR/auth.json";
import ptBRCore from "./pt-BR/core.json";
import ptBRBilling from "./pt-BR/billing.json";
import ptBRHomepage from "./pt-BR/homepage.json";
import ptBRTemplates from "./pt-BR/templates.json";
import ptBRValidation from "./pt-BR/validation.json";
import ptBRRoles from "./pt-BR/roles.json";
import ptBREntities from "./pt-BR/entities.json";
import ptBRResources from "./pt-BR/resources.json";

import type { SupportedLocale } from "@/src/contracts/high_level/i18n";

type TranslationMap = Record<string, string>;

const translations: Record<string, Record<string, TranslationMap>> = {
  en: {
    common: enCommon,
    auth: enAuth,
    core: enCore,
    billing: enBilling,
    homepage: enHomepage,
    templates: enTemplates,
    validation: enValidation,
    roles: enRoles,
    entities: enEntities,
    resources: enResources,
  },
  "pt-BR": {
    common: ptBRCommon,
    auth: ptBRAuth,
    core: ptBRCore,
    billing: ptBRBilling,
    homepage: ptBRHomepage,
    templates: ptBRTemplates,
    validation: ptBRValidation,
    roles: ptBRRoles,
    entities: ptBREntities,
    resources: ptBRResources,
  },
};

const systemTranslations: Record<string, Record<string, TranslationMap>> = {};
const frameworkTranslations: Record<string, Record<string, TranslationMap>> =
  {};

export function registerSystemI18n(
  systemSlug: string,
  locale: string,
  data: TranslationMap,
): void {
  if (!systemTranslations[locale]) {
    systemTranslations[locale] = {};
  }
  systemTranslations[locale][systemSlug] = data;
}

export function registerFrameworkI18n(
  frameworkName: string,
  locale: string,
  data: TranslationMap,
): void {
  if (!frameworkTranslations[locale]) {
    frameworkTranslations[locale] = {};
  }
  frameworkTranslations[locale][frameworkName] = data;
}

export function t(
  key: string,
  locale: string,
  params?: Record<string, string>,
): string {
  const parts = key.split(".");
  const domain = parts[0];
  const rest = parts.slice(1).join(".");

  const localeData = translations[locale] ?? translations["en"];
  let value: string | undefined;

  if (domain === "systems" && parts.length >= 3) {
    const systemSlug = parts[1];
    const systemKey = parts.slice(2).join(".");
    value = systemTranslations[locale]?.[systemSlug]?.[systemKey] ??
      systemTranslations["en"]?.[systemSlug]?.[systemKey];
  } else if (domain === "frameworks" && parts.length >= 3) {
    const frameworkName = parts[1];
    const frameworkKey = parts.slice(2).join(".");
    value = frameworkTranslations[locale]?.[frameworkName]?.[frameworkKey] ??
      frameworkTranslations["en"]?.[frameworkName]?.[frameworkKey];
  } else {
    const domainData = localeData?.[domain] ?? translations["en"]?.[domain];
    value = domainData?.[rest];
  }

  if (!value) return key;

  if (params) {
    return Object.entries(params).reduce(
      (result, [k, v]) => result.replace(new RegExp(`\\{${k}\\}`, "g"), v),
      value,
    );
  }

  return value;
}

export { type SupportedLocale } from "@/src/contracts/high_level/i18n";
export const supportedLocales = ["en", "pt-BR"] as const;
export const defaultLocale: SupportedLocale = "en";
