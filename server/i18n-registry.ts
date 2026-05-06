import "server-only";

import type {
  ClientTranslations,
  I18nState,
  TranslationLoader,
  TranslationMap,
} from "../src/contracts/high-level/i18n";
import { setTranslationResolver } from "../src/i18n/index.ts";

import { getState } from "./global-registry.ts";

function getI18nState(): I18nState {
  return getState<I18nState>("__grex_i18n_state__", {
    systemTranslations: {},
    frameworkTranslations: {},
    pendingSystemLoaders: [],
    pendingFrameworkLoaders: [],
  });
}

export function registerSystemI18n(
  systemSlug: string,
  locale: string,
  loader: TranslationLoader,
): void {
  getI18nState().pendingSystemLoaders.push({
    slug: systemSlug,
    locale,
    loader,
  });
}

export function registerFrameworkI18n(
  frameworkName: string,
  locale: string,
  loader: TranslationLoader,
): void {
  getI18nState().pendingFrameworkLoaders.push({
    name: frameworkName,
    locale,
    loader,
  });
}

export async function loadAllTranslations(): Promise<void> {
  const state = getI18nState();

  for (const { slug, locale, loader } of state.pendingSystemLoaders) {
    const mod = await loader();
    const map = (mod as Record<string, TranslationMap>).default ?? mod;
    if (!state.systemTranslations[locale]) {
      state.systemTranslations[locale] = {};
    }
    state.systemTranslations[locale][slug] = map;
  }
  state.pendingSystemLoaders.length = 0;

  for (const { name, locale, loader } of state.pendingFrameworkLoaders) {
    const mod = await loader();
    const map = (mod as Record<string, TranslationMap>).default ?? mod;
    if (!state.frameworkTranslations[locale]) {
      state.frameworkTranslations[locale] = {};
    }
    state.frameworkTranslations[locale][name] = map;
  }
  state.pendingFrameworkLoaders.length = 0;
}

export function getTranslationsForClient(
  locale: string,
  systemSlug?: string,
  frameworkNames?: string[],
): ClientTranslations {
  const state = getI18nState();
  const locales = locale === "en" ? ["en"] : ["en", locale];
  const result: ClientTranslations = { systems: {}, frameworks: {} };

  if (systemSlug) {
    for (const loc of locales) {
      const map = state.systemTranslations[loc]?.[systemSlug];
      if (map && Object.keys(map).length > 0) {
        if (!result.systems[loc]) result.systems[loc] = {};
        result.systems[loc][systemSlug] = map;
      }
    }
  }

  const names = frameworkNames && frameworkNames.length > 0
    ? frameworkNames
    : getAllFrameworkNames(state);

  for (const name of names) {
    for (const loc of locales) {
      const map = state.frameworkTranslations[loc]?.[name];
      if (map && Object.keys(map).length > 0) {
        if (!result.frameworks[loc]) result.frameworks[loc] = {};
        result.frameworks[loc][name] = map;
      }
    }
  }

  return result;
}

function getAllFrameworkNames(state: I18nState): string[] {
  const names = new Set<string>();
  for (const loc of Object.keys(state.frameworkTranslations)) {
    for (const name of Object.keys(state.frameworkTranslations[loc] ?? {})) {
      names.add(name);
    }
  }
  return [...names];
}

function resolve(
  locale: string,
  domain: string,
  namespace: string,
  key: string,
): string | undefined {
  const state = getI18nState();
  const map = domain === "systems"
    ? state.systemTranslations
    : state.frameworkTranslations;
  return map[locale]?.[namespace]?.[key];
}

setTranslationResolver(resolve);
