import { clearCache, getCache, registerCache, updateCache } from "./cache.ts";
import type { FrontSetting } from "@/src/contracts/front-setting";
import type {
  FrontCoreData,
  MissingFrontSetting,
  PublicSystemData,
} from "@/src/contracts/high_level/cache-data";
import { assertServerOnly } from "./server-only.ts";
import { loadFrontSettingsForScope } from "../db/queries/front-settings.ts";
import {
  buildScopeKey,
  resolveScopeChain,
} from "../db/queries/core-settings.ts";
import type { SettingScope } from "@/src/contracts/high_level/cache-data";
import Core from "./Core.ts";

assertServerOnly("FrontCore");

const SETTINGS_SLUG = "front-settings";
const trackedScopes: Set<string> = new Set();

export async function loadFrontCoreData(): Promise<FrontCoreData> {
  const settings = await loadFrontSettingsForScope("__core__");

  console.log(
    `[FrontCore] loaded ${settings.size} core front settings from DB`,
  );

  return { settings };
}

class FrontCore {
  private static instance: FrontCore | null = null;
  private missingSettings: Map<string, MissingFrontSetting> = new Map();
  private publicSystemRegistered: Set<string> = new Set();

  private constructor() {}

  static getInstance(): FrontCore {
    if (!FrontCore.instance) {
      FrontCore.instance = new FrontCore();
    }
    return FrontCore.instance;
  }

  async getSetting(
    key: string,
    scope?: SettingScope,
  ): Promise<string | undefined> {
    const scopeChain = resolveScopeChain(scope);

    for (const scopeKey of scopeChain) {
      const scopeSettings = await this.getOrLoadScope(scopeKey);
      const setting = scopeSettings.get(key);
      if (setting) return setting.value;
    }

    if (!this.missingSettings.has(key)) {
      this.missingSettings.set(key, {
        key,
        firstRequestedAt: new Date().toISOString(),
      });
      console.warn(`[FrontCore] setting "${key}" not defined`);
    }

    return undefined;
  }

  private async getOrLoadScope(
    scopeKey: string,
  ): Promise<Map<string, FrontSetting>> {
    const cacheName = `settings:${scopeKey}`;

    if (!trackedScopes.has(scopeKey)) {
      registerCache(
        SETTINGS_SLUG,
        cacheName,
        () => loadFrontSettingsForScope(scopeKey),
      );
      trackedScopes.add(scopeKey);
    }

    return getCache<Map<string, FrontSetting>>(SETTINGS_SLUG, cacheName);
  }

  async refreshSettingsScope(scopeKey: string): Promise<void> {
    const cacheName = `settings:${scopeKey}`;
    if (trackedScopes.has(scopeKey)) {
      await updateCache(SETTINGS_SLUG, cacheName);
    }
  }

  async getMissingSettings(): Promise<MissingFrontSetting[]> {
    return Array.from(this.missingSettings.values());
  }

  /**
   * Returns public system data (name, slug, logoUri, defaultLocale,
   * termsOfService) from the Core cache. Systems are cached via
   * Core.getInstance().getSystemBySlug().
   */
  async getPublicSystemData(
    systemSlug: string,
  ): Promise<PublicSystemData | undefined> {
    const cacheName = `publicSystem:${systemSlug}`;

    if (!this.publicSystemRegistered.has(cacheName)) {
      registerCache(SETTINGS_SLUG, cacheName, async () => {
        const core = Core.getInstance();
        const system = await core.getSystemBySlug(systemSlug);
        if (!system) return undefined;

        const genericTerms = (await core.getSetting("terms.generic")) || "";
        const termsOfService = system.termsOfService || genericTerms ||
          undefined;

        const data: PublicSystemData = {
          name: system.name,
          slug: system.slug,
          logoUri: system.logoUri,
          defaultLocale: system.defaultLocale,
          termsOfService,
        };
        return data;
      });
      this.publicSystemRegistered.add(cacheName);
    }

    return getCache<PublicSystemData | undefined>(
      SETTINGS_SLUG,
      cacheName,
    );
  }

  async reload(): Promise<void> {
    for (const scopeKey of trackedScopes) {
      const cacheName = `settings:${scopeKey}`;
      try {
        await updateCache(SETTINGS_SLUG, cacheName);
      } catch {
        // Cache may not be registered yet; skip
      }
    }
    this.missingSettings.clear();

    // Clear public system data caches
    for (const cacheName of this.publicSystemRegistered) {
      clearCache(SETTINGS_SLUG, cacheName);
    }
    this.publicSystemRegistered.clear();
  }
}

export default FrontCore;
