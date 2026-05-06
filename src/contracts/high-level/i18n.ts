// ============================================================================
// Internationalization contracts — locale identifiers used by TenantProvider,
// layout, and i18n configuration.
// ============================================================================

export type SupportedLocale = "en" | "pt-BR";

export type TranslationMap = Record<string, string>;

export interface ClientTranslations {
  systems: Record<string, Record<string, TranslationMap>>;
  frameworks: Record<string, Record<string, TranslationMap>>;
}

export type TranslationLoader = () => Promise<{ default: TranslationMap }>;
export interface I18nState {
  systemTranslations: Record<string, Record<string, TranslationMap>>;
  frameworkTranslations: Record<string, Record<string, TranslationMap>>;
  pendingSystemLoaders: {
    slug: string;
    locale: string;
    loader: TranslationLoader;
  }[];
  pendingFrameworkLoaders: {
    name: string;
    locale: string;
    loader: TranslationLoader;
  }[];
}
