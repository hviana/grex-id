import { getDb, rid } from "../db/connection.ts";
import type { System } from "@/src/contracts/system";
import type { Role } from "@/src/contracts/role";
import type { Plan } from "@/src/contracts/plan";
import type { MenuItem } from "@/src/contracts/menu";
import type { CoreSetting } from "@/src/contracts/core-settings";
import type { Voucher } from "@/src/contracts/voucher";
import type { Subscription } from "@/src/contracts/billing";
import dbConfig from "../../database.json";

if (typeof window !== "undefined") {
  throw new Error("Core must not be imported in client-side code.");
}

export interface MissingSetting {
  key: string;
  firstRequestedAt: string;
}

class Core {
  static readonly DB_URL = dbConfig.url;
  static readonly DB_USER = dbConfig.user;
  static readonly DB_PASS = dbConfig.pass;
  static readonly DB_NAMESPACE = dbConfig.namespace;
  static readonly DB_DATABASE = dbConfig.database;

  private static instance: Core | null = null;
  private loaded = false;
  private loadPromise: Promise<void> | null = null;

  systems: System[] = [];
  roles: Role[] = [];
  plans: Plan[] = [];
  vouchers: Voucher[] = [];
  menus: MenuItem[] = [];
  settings: Map<string, CoreSetting> = new Map();
  private missingSettings: Map<string, MissingSetting> = new Map();
  private subscriptions: Map<string, Subscription> = new Map();

  // Index maps — populated during load(), O(1) lookup
  private systemsBySlug: Map<string, System> = new Map();
  private rolesBySystem: Map<string, Role[]> = new Map();
  private plansBySystem: Map<string, Plan[]> = new Map();
  private menusBySystem: Map<string, MenuItem[]> = new Map();
  private plansById: Map<string, Plan> = new Map();
  private vouchersById: Map<string, Voucher> = new Map();

  private constructor() {}

  static getInstance(): Core {
    if (!Core.instance) {
      Core.instance = new Core();
    }
    return Core.instance;
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
    const db = await getDb();

    const results = await db.query<
      [System[], Role[], Plan[], MenuItem[], CoreSetting[], Voucher[]]
    >(
      `SELECT * FROM system;
      SELECT * FROM role;
      SELECT * FROM plan;
      SELECT * FROM menu_item ORDER BY sortOrder ASC;
      SELECT * FROM core_setting;
      SELECT * FROM voucher;`,
    );

    const systems = results[0] ?? [];
    const roles = results[1] ?? [];
    const plans = results[2] ?? [];
    const menus = results[3] ?? [];
    const settings = results[4] ?? [];
    const vouchers = results[5] ?? [];

    this.systems = systems;
    this.roles = roles;
    this.plans = plans;
    this.menus = menus;
    this.vouchers = vouchers;

    // Rebuild index maps
    this.systemsBySlug.clear();
    for (const s of systems) {
      this.systemsBySlug.set(s.slug, s);
    }

    this.rolesBySystem.clear();
    for (const r of roles) {
      const key = String(r.systemId);
      let list = this.rolesBySystem.get(key);
      if (!list) {
        list = [];
        this.rolesBySystem.set(key, list);
      }
      list.push(r);
    }

    this.plansBySystem.clear();
    this.plansById.clear();
    for (const p of plans) {
      const sysKey = String(p.systemId);
      let list = this.plansBySystem.get(sysKey);
      if (!list) {
        list = [];
        this.plansBySystem.set(sysKey, list);
      }
      list.push(p);
      this.plansById.set(String(p.id), p);
    }

    this.menusBySystem.clear();
    for (const m of menus) {
      const key = String(m.systemId);
      let list = this.menusBySystem.get(key);
      if (!list) {
        list = [];
        this.menusBySystem.set(key, list);
      }
      list.push(m);
    }

    this.vouchersById.clear();
    for (const v of vouchers) {
      this.vouchersById.set(String(v.id), v);
    }

    this.settings.clear();
    for (const setting of settings) {
      this.settings.set(setting.key, setting);
      this.missingSettings.delete(setting.key);
    }

    console.log(
      `[Core] loaded: ${systems.length} systems, ${roles.length} roles, ${plans.length} plans, ${vouchers.length} vouchers, ${menus.length} menus, ${this.settings.size} settings`,
    );
  }

  async reload(): Promise<void> {
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
      console.warn(`[Core] setting "${key}" not defined`);
    }

    return undefined;
  }

  async getMissingSettings(): Promise<MissingSetting[]> {
    await this.ensureLoaded();
    return Array.from(this.missingSettings.values());
  }

  async getSystemBySlug(slug: string): Promise<System | undefined> {
    await this.ensureLoaded();
    return this.systemsBySlug.get(slug);
  }

  async getRolesForSystem(systemId: string): Promise<Role[]> {
    await this.ensureLoaded();
    return this.rolesBySystem.get(String(systemId)) ?? [];
  }

  async getPlansForSystem(systemId: string): Promise<Plan[]> {
    await this.ensureLoaded();
    return this.plansBySystem.get(String(systemId)) ?? [];
  }

  async getMenusForSystem(systemId: string): Promise<MenuItem[]> {
    await this.ensureLoaded();
    const systemMenus = this.menusBySystem.get(String(systemId)) ?? [];
    return buildMenuTree(systemMenus);
  }

  getPlanById(planId: string): Plan | undefined {
    return this.plansById.get(String(planId));
  }

  getVoucherById(voucherId: string): Voucher | undefined {
    return this.vouchersById.get(String(voucherId));
  }

  getActiveSubscriptionCached(
    companyId: string,
    systemId: string,
  ): Subscription | undefined {
    return this.subscriptions.get(`${companyId}:${systemId}`);
  }

  async ensureSubscription(
    companyId: string,
    systemId: string,
  ): Promise<Subscription | null> {
    const key = `${companyId}:${systemId}`;
    if (this.subscriptions.has(key)) {
      return this.subscriptions.get(key)!;
    }
    return this.reloadSubscription(companyId, systemId);
  }

  async reloadSubscription(
    companyId: string,
    systemId: string,
  ): Promise<Subscription | null> {
    const db = await getDb();
    const key = `${companyId}:${systemId}`;

    const result = await db.query<[Subscription[]]>(
      `SELECT * FROM subscription
       WHERE companyId = $companyId AND systemId = $systemId AND status = "active"
       LIMIT 1`,
      { companyId: rid(companyId), systemId: rid(systemId) },
    );

    const sub = result[0]?.[0] ?? null;
    if (sub) {
      this.subscriptions.set(key, sub);
    } else {
      this.subscriptions.delete(key);
    }
    return sub;
  }

  evictSubscription(companyId: string, systemId: string): void {
    this.subscriptions.delete(`${companyId}:${systemId}`);
  }

  evictAllSubscriptions(): void {
    this.subscriptions.clear();
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
