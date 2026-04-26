import { getCache, updateCache } from "./cache.ts";
import type { FrontCoreSetting } from "@/src/contracts/core-settings.ts";
import { assertServerOnly } from "./server-only.ts";
import { fetchAllFrontSettings } from "../db/queries/front-settings.ts";

assertServerOnly("FrontCore");

export interface MissingFrontSetting {
  key: string;
  firstRequestedAt: string;
}

export interface FrontCoreData {
  settings: Map<string, FrontCoreSetting>;
}

const CACHE_SLUG = "core";
const CACHE_NAME = "front-data";

export async function loadFrontCoreData(): Promise<FrontCoreData> {
  const rows = await fetchAllFrontSettings();

  const settings = new Map<string, FrontCoreSetting>();
  for (const setting of rows) {
    const slug = setting.tenantIds && setting.tenantIds.length > 0
      ? setting.tenantIds[0]
      : "core";
    const mapKey = slug + ":" + setting.key;
    settings.set(mapKey, setting);
  }

  console.log(
    `[FrontCore] loaded ${settings.size} front settings from DB`,
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

  async getSetting(
    key: string,
    systemSlug?: string,
  ): Promise<string | undefined> {
    const data = await getCache<FrontCoreData>(CACHE_SLUG, CACHE_NAME);

    if (systemSlug && systemSlug !== "core") {
      const specific = data.settings.get(`${systemSlug}:${key}`);
      if (specific) return specific.value;
    }

    const core = data.settings.get(`core:${key}`);
    if (core) return core.value;

    // Last resort: search all scopes for this key
    for (const setting of data.settings.values()) {
      if (setting.key === key) return setting.value;
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

  async getMissingSettings(): Promise<MissingFrontSetting[]> {
    await getCache<FrontCoreData>(CACHE_SLUG, CACHE_NAME);
    return Array.from(this.missingSettings.values());
  }

  async reload(): Promise<void> {
    await updateCache<FrontCoreData>(CACHE_SLUG, CACHE_NAME);
    this.missingSettings.clear();
  }
}

export default FrontCore;
