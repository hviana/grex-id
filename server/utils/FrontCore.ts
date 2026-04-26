import { clearCache, getCache, registerCache, updateCache } from "./cache.ts";
import type { FrontCoreSetting } from "@/src/contracts/core-settings.ts";
import { assertServerOnly } from "./server-only.ts";
import { loadFrontSettingsForScope } from "../db/queries/front-settings.ts";
import {
  buildScopeKey,
  resolveScopeChain,
  type SettingScope,
} from "../db/queries/core-settings.ts";

assertServerOnly("FrontCore");

export interface MissingFrontSetting {
  key: string;
  firstRequestedAt: string;
}

export interface FrontCoreData {
  settings: Map<string, FrontCoreSetting>;
}

const SETTINGS_SLUG = "front-settings";
const trackedScopes: Set<string> = new Set();

/**
 * Loads core-level front settings for the initial cache hydration.
 */
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

  private constructor() {}

  static getInstance(): FrontCore {
    if (!FrontCore.instance) {
      FrontCore.instance = new FrontCore();
    }
    return FrontCore.instance;
  }

  /**
   * Retrieves a front setting value by walking the scope hierarchy:
   * actor-scoped → company-system-scoped → system-scoped → core-level.
   * Settings are loaded lazily per scope and cached.
   */
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
  ): Promise<Map<string, FrontCoreSetting>> {
    const cacheName = `settings:${scopeKey}`;

    if (!trackedScopes.has(scopeKey)) {
      registerCache(
        SETTINGS_SLUG,
        cacheName,
        () => loadFrontSettingsForScope(scopeKey),
      );
      trackedScopes.add(scopeKey);
    }

    return getCache<Map<string, FrontCoreSetting>>(SETTINGS_SLUG, cacheName);
  }

  /**
   * Refreshes a specific scope's front settings cache after a mutation.
   */
  async refreshSettingsScope(scopeKey: string): Promise<void> {
    const cacheName = `settings:${scopeKey}`;
    if (trackedScopes.has(scopeKey)) {
      await updateCache(SETTINGS_SLUG, cacheName);
    }
  }

  async getMissingSettings(): Promise<MissingFrontSetting[]> {
    return Array.from(this.missingSettings.values());
  }

  async reload(): Promise<void> {
    // Refresh all loaded front-settings scopes
    for (const scopeKey of trackedScopes) {
      const cacheName = `settings:${scopeKey}`;
      try {
        await updateCache(SETTINGS_SLUG, cacheName);
      } catch {
        // Cache may not be registered yet; skip
      }
    }
    this.missingSettings.clear();
  }
}

export default FrontCore;
