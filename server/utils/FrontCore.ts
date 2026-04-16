import type { FrontCoreSetting } from "@/src/contracts/core-settings.ts";

// NOTE: No server-only guard — this file is isomorphic (safe for frontend import)

export interface MissingFrontSetting {
  key: string;
  firstRequestedAt: string;
}

class FrontCore {
  private static instance: FrontCore | null = null;
  private loaded = false;
  private loadPromise: Promise<void> | null = null;
  private isServer = typeof window === "undefined";

  settings: Map<string, FrontCoreSetting> = new Map();
  private missingSettings: Map<string, MissingFrontSetting> = new Map();

  private constructor() {}

  static getInstance(): FrontCore {
    if (!FrontCore.instance) {
      FrontCore.instance = new FrontCore();
    }
    return FrontCore.instance;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    if (!this.loadPromise) {
      this.loadPromise = this.load().then(() => {
        this.loaded = true;
        this.loadPromise = null;
      });
    }
    await this.loadPromise;
  }

  async load(): Promise<void> {
    if (this.isServer) {
      await this.loadFromDb();
    } else {
      await this.loadFromApi();
    }
  }

  private async loadFromDb(): Promise<void> {
    try {
      const { getDb } = await import("../db/connection.ts");
      const db = await getDb();
      const results = await db.query<[FrontCoreSetting[]]>(
        "SELECT * FROM front_core_setting;",
      );

      this.settings.clear();
      for (const setting of results[0] ?? []) {
        this.settings.set(setting.key, setting);
        this.missingSettings.delete(setting.key);
      }

      console.log(
        `[FrontCore] loaded ${this.settings.size} front settings from DB`,
      );
    } catch (err) {
      console.error("[FrontCore] failed to load from DB:", err);
    }
  }

  private async loadFromApi(): Promise<void> {
    try {
      const res = await fetch("/api/public/front-core");
      const json = await res.json();
      if (json.success && json.data) {
        this.settings.clear();
        const entries = json.data as Record<string, FrontCoreSetting>;
        for (const [key, setting] of Object.entries(entries)) {
          this.settings.set(key, setting);
          this.missingSettings.delete(key);
        }
        console.log(
          `[FrontCore] loaded ${this.settings.size} front settings from API`,
        );
      }
    } catch (err) {
      console.error("[FrontCore] failed to load from API:", err);
    }
  }

  async reload(): Promise<void> {
    this.loaded = false;
    this.loadPromise = null;
    await this.load();
  }

  async getSetting(key: string): Promise<string | undefined> {
    await this.ensureLoaded();
    const existing = this.settings.get(key);
    if (existing) return existing.value;

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
    await this.ensureLoaded();
    return Array.from(this.missingSettings.values());
  }
}

export default FrontCore;
