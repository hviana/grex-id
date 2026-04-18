import {
  getCache,
  updateCache,
} from "./cache.ts";
import type { FrontCoreSetting } from "@/src/contracts/core-settings.ts";

if (typeof window !== "undefined") {
  throw new Error("FrontCore must not be imported in client-side code.");
}

export interface MissingFrontSetting {
  key: string;
  firstRequestedAt: string;
}

export interface FrontCoreData {
  settings: Map<string, FrontCoreSetting>;
}

const FRONT_SLUG = "front-core";

export async function loadFrontCoreData(): Promise<FrontCoreData> {
  const { getDb } = await import("../db/connection.ts");
  const db = await getDb();
  const results = await db.query<[FrontCoreSetting[]]>(
    "SELECT * FROM front_setting;",
  );

  const settings = new Map<string, FrontCoreSetting>();
  for (const setting of results[0] ?? []) {
    const mapKey = (setting.systemSlug ?? "") + ":" + setting.key;
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

  async getSetting(key: string, systemSlug?: string): Promise<string | undefined> {
    const data = await getCache<FrontCoreData>(FRONT_SLUG, "data");

    if (systemSlug) {
      const specific = data.settings.get(`${systemSlug}:${key}`);
      if (specific) return specific.value;
    }

    const core = data.settings.get(`:${key}`);
    if (core) return core.value;

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
    await getCache<FrontCoreData>(FRONT_SLUG, "data");
    return Array.from(this.missingSettings.values());
  }

  async reload(): Promise<void> {
    await updateCache<FrontCoreData>(FRONT_SLUG, "data");
  }
}

export default FrontCore;
