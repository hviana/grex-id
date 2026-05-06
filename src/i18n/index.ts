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
import enPlans from "./en/plans.json";
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
import ptBRPlans from "./pt-BR/plans.json";

import type {
  ClientTranslations,
  SupportedLocale,
  TranslationMap,
} from "@/src/contracts/high-level/i18n";

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
    plans: enPlans,
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
    plans: ptBRPlans,
  },
};

type TranslationResolver = (
  locale: string,
  domain: string,
  namespace: string,
  key: string,
) => string | undefined;

let resolver: TranslationResolver | null = null;

export function setTranslationResolver(
  r: TranslationResolver,
): void {
  resolver = r;
}

export function t(
  key: string,
  locale: string,
  params?: Record<string, string>,
  clientTranslations?: ClientTranslations,
): string {
  const parts = key.split(".");
  const domain = parts[0];
  const rest = parts.slice(1).join(".");

  const localeData = translations[locale] ?? translations["en"];
  let value: string | undefined;

  if (domain === "systems" && parts.length >= 3) {
    const systemSlug = parts[1];
    const systemKey = parts.slice(2).join(".");
    value = resolver?.(locale, "systems", systemSlug, systemKey) ??
      resolver?.("en", "systems", systemSlug, systemKey) ??
      clientTranslations?.systems[locale]?.[systemSlug]?.[systemKey] ??
      clientTranslations?.systems["en"]?.[systemSlug]?.[systemKey];
  } else if (domain === "frameworks" && parts.length >= 3) {
    const frameworkName = parts[1];
    const frameworkKey = parts.slice(2).join(".");
    value = resolver?.(locale, "frameworks", frameworkName, frameworkKey) ??
      resolver?.("en", "frameworks", frameworkName, frameworkKey) ??
      clientTranslations?.frameworks[locale]?.[frameworkName]?.[frameworkKey] ??
      clientTranslations?.frameworks["en"]?.[frameworkName]?.[frameworkKey];
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

export const supportedLocales = ["en", "pt-BR"] as const;
export const defaultLocale: SupportedLocale = "en";
