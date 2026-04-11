import { getDb } from "../db/connection.ts";
import type { System } from "@/src/contracts/system";
import type { Role } from "@/src/contracts/role";
import type { Plan } from "@/src/contracts/plan";
import type { MenuItem } from "@/src/contracts/menu";
import type { CoreSetting } from "@/src/contracts/core-settings";

if (typeof window !== "undefined") {
  throw new Error("Core must not be imported in client-side code.");
}

export interface MissingSetting {
  key: string;
  firstRequestedAt: string;
}

class Core {
  private static instance: Core | null = null;
  private loaded = false;
  private loadPromise: Promise<void> | null = null;

  systems: System[] = [];
  roles: Role[] = [];
  plans: Plan[] = [];
  menus: MenuItem[] = [];
  settings: Map<string, CoreSetting> = new Map();
  private missingSettings: Map<string, MissingSetting> = new Map();

  private constructor() {}

  static getInstance(): Core {
    if (!Core.instance) {
      Core.instance = new Core();
    }
    return Core.instance;
  }

  async ensureLoaded(): Promise<void> {
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
    const db = await getDb();

    const results = await db.query<
      [System[], Role[], Plan[], MenuItem[], CoreSetting[]]
    >(
      `SELECT * FROM system;
      SELECT * FROM role;
      SELECT * FROM plan;
      SELECT * FROM menu_item ORDER BY sortOrder ASC;
      SELECT * FROM core_setting;`,
    );

    this.systems = results[0] ?? [];
    this.roles = results[1] ?? [];
    this.plans = results[2] ?? [];
    this.menus = results[3] ?? [];

    this.settings.clear();
    for (const setting of results[4] ?? []) {
      this.settings.set(setting.key, setting);
      this.missingSettings.delete(setting.key);
    }

    console.log(
      `[Core] loaded: ${this.systems.length} systems, ${this.roles.length} roles, ${this.plans.length} plans, ${this.menus.length} menus, ${this.settings.size} settings`,
    );
  }

  async reload(): Promise<void> {
    await this.load();
  }

  getSetting(key: string): string | undefined {
    const existing = this.settings.get(key);
    if (existing) return existing.value;

    if (!this.missingSettings.has(key)) {
      this.missingSettings.set(key, {
        key,
        firstRequestedAt: new Date().toISOString(),
      });
      console.warn(`[Core] setting "${key}" not defined`);
    }

    return undefined;
  }

  getMissingSettings(): MissingSetting[] {
    return Array.from(this.missingSettings.values());
  }

  getSystemBySlug(slug: string): System | undefined {
    return this.systems.find((s) => s.slug === slug);
  }

  getRolesForSystem(systemId: string): Role[] {
    return this.roles.filter((r) => r.systemId === systemId);
  }

  getPlansForSystem(systemId: string): Plan[] {
    return this.plans.filter((p) => p.systemId === systemId);
  }

  getMenusForSystem(systemId: string): MenuItem[] {
    const systemMenus = this.menus.filter((m) => m.systemId === systemId);
    return buildMenuTree(systemMenus);
  }
}

function buildMenuTree(items: MenuItem[]): MenuItem[] {
  const map = new Map<string, MenuItem>();
  const roots: MenuItem[] = [];

  for (const item of items) {
    map.set(item.id, { ...item, children: [] });
  }

  for (const item of items) {
    const node = map.get(item.id)!;
    if (item.parentId) {
      const parent = map.get(item.parentId);
      if (parent) {
        parent.children ??= [];
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    } else {
      roots.push(node);
    }
  }

  return roots;
}

export default Core;
