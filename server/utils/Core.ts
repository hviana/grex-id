import { clearCache, getCache, registerCache, updateCache } from "./cache.ts";
import type { System } from "@/src/contracts/system";
import type { Role } from "@/src/contracts/role";
import type { Plan } from "@/src/contracts/plan";
import type { MenuItem } from "@/src/contracts/menu";
import type { CoreSetting } from "@/src/contracts/core-settings";
import type { Voucher } from "@/src/contracts/voucher";
import type { Subscription } from "@/src/contracts/billing";
import dbConfig from "../../database.json" with { type: "json" };
import { assertServerOnly } from "./server-only.ts";
import {
  fetchActiveSubscription,
  fetchAllCoreData,
} from "../db/queries/core-settings.ts";

assertServerOnly("Core");

export interface MissingSetting {
  key: string;
  firstRequestedAt: string;
}

export interface CoreData {
  systems: System[];
  roles: Role[];
  plans: Plan[];
  vouchers: Voucher[];
  menus: MenuItem[];
  settings: Map<string, CoreSetting>;
  systemsBySlug: Map<string, System>;
  rolesBySystem: Map<string, Role[]>;
  plansBySystem: Map<string, Plan[]>;
  menusBySystem: Map<string, MenuItem[]>;
  plansById: Map<string, Plan>;
  vouchersById: Map<string, Voucher>;
}

const CORE_SLUG = "core";

export async function loadCoreData(): Promise<CoreData> {
  const results = await fetchAllCoreData();

  const systems = results[0] ?? [];
  const roles = results[1] ?? [];
  const plans = results[2] ?? [];
  const menus = results[3] ?? [];
  const settings = results[4] ?? [];
  const vouchers = results[5] ?? [];

  const systemsBySlug = new Map<string, System>();
  for (const s of systems) {
    systemsBySlug.set(s.slug, s);
  }

  const rolesBySystem = new Map<string, Role[]>();
  for (const r of roles) {
    const key = String(r.systemId);
    let list = rolesBySystem.get(key);
    if (!list) {
      list = [];
      rolesBySystem.set(key, list);
    }
    list.push(r);
  }

  const plansBySystem = new Map<string, Plan[]>();
  const plansById = new Map<string, Plan>();
  for (const p of plans) {
    const sysKey = String(p.systemId);
    let list = plansBySystem.get(sysKey);
    if (!list) {
      list = [];
      plansBySystem.set(sysKey, list);
    }
    list.push(p);
    plansById.set(String(p.id), p);
  }

  const menusBySystem = new Map<string, MenuItem[]>();
  for (const m of menus) {
    const key = String(m.systemId);
    let list = menusBySystem.get(key);
    if (!list) {
      list = [];
      menusBySystem.set(key, list);
    }
    list.push(m);
  }

  const vouchersById = new Map<string, Voucher>();
  for (const v of vouchers) {
    vouchersById.set(String(v.id), v);
  }

  const settingsMap = new Map<string, CoreSetting>();
  for (const setting of settings) {
    const slug = setting.systemSlug && setting.systemSlug.length > 0
      ? setting.systemSlug
      : "core";
    const mapKey = slug + ":" + setting.key;
    settingsMap.set(mapKey, setting);
  }

  console.log(
    `[Core] loaded: ${systems.length} systems, ${roles.length} roles, ${plans.length} plans, ${vouchers.length} vouchers, ${menus.length} menus, ${settingsMap.size} settings`,
  );

  return {
    systems,
    roles,
    plans,
    vouchers,
    menus,
    settings: settingsMap,
    systemsBySlug,
    rolesBySystem,
    plansBySystem,
    menusBySystem,
    plansById,
    vouchersById,
  };
}

async function loadSubscription(
  companyId: string,
  systemId: string,
): Promise<Subscription | null> {
  const rows = await fetchActiveSubscription({ companyId, systemId });
  return rows[0] ?? null;
}

// Tracked subscription cache keys for bulk eviction
const subscriptionKeys: Set<string> = new Set();

class Core {
  static readonly DB_URL = dbConfig.url;
  static readonly DB_USER = dbConfig.user;
  static readonly DB_PASS = dbConfig.pass;
  static readonly DB_NAMESPACE = dbConfig.namespace;
  static readonly DB_DATABASE = dbConfig.database;

  private static instance: Core | null = null;
  private missingSettings: Map<string, MissingSetting> = new Map();

  private constructor() {}

  static getInstance(): Core {
    if (!Core.instance) {
      Core.instance = new Core();
    }
    return Core.instance;
  }

  async getSetting(
    key: string,
    systemSlug?: string,
  ): Promise<string | undefined> {
    const data = await getCache<CoreData>(CORE_SLUG, "data");

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
      console.warn(`[Core] setting "${key}" not defined`);
    }

    return undefined;
  }

  async getMissingSettings(): Promise<MissingSetting[]> {
    return Array.from(this.missingSettings.values());
  }

  async getSystemBySlug(slug: string): Promise<System | undefined> {
    const data = await getCache<CoreData>(CORE_SLUG, "data");
    return data.systemsBySlug.get(slug);
  }

  async getAllSystems(): Promise<System[]> {
    const data = await getCache<CoreData>(CORE_SLUG, "data");
    return Array.from(data.systemsBySlug.values());
  }

  async getRolesForSystem(systemId: string): Promise<Role[]> {
    const data = await getCache<CoreData>(CORE_SLUG, "data");
    return data.rolesBySystem.get(String(systemId)) ?? [];
  }

  async getPlansForSystem(systemId: string): Promise<Plan[]> {
    const data = await getCache<CoreData>(CORE_SLUG, "data");
    return data.plansBySystem.get(String(systemId)) ?? [];
  }

  async getMenusForSystem(systemId: string): Promise<MenuItem[]> {
    const data = await getCache<CoreData>(CORE_SLUG, "data");
    const systemMenus = data.menusBySystem.get(String(systemId)) ?? [];
    return buildMenuTree(systemMenus);
  }

  async getPlanById(planId: string): Promise<Plan | undefined> {
    const data = await getCache<CoreData>(CORE_SLUG, "data");
    return data.plansById.get(String(planId));
  }

  async getVoucherById(voucherId: string): Promise<Voucher | undefined> {
    const data = await getCache<CoreData>(CORE_SLUG, "data");
    return data.vouchersById.get(String(voucherId));
  }

  async getActiveSubscriptionCached(
    companyId: string,
    systemId: string,
  ): Promise<Subscription | undefined> {
    const key = `${companyId}:${systemId}`;
    const cacheName = `sub:${key}`;
    try {
      return await getCache<Subscription>(CORE_SLUG, cacheName);
    } catch {
      return undefined;
    }
  }

  async ensureSubscription(
    companyId: string,
    systemId: string,
  ): Promise<Subscription | null> {
    const key = `${companyId}:${systemId}`;
    const cacheName = `sub:${key}`;

    if (!subscriptionKeys.has(cacheName)) {
      registerCache(
        CORE_SLUG,
        cacheName,
        () => loadSubscription(companyId, systemId),
      );
      subscriptionKeys.add(cacheName);
    }

    const cached = await getCache<Subscription | null>(CORE_SLUG, cacheName);
    return cached ?? null;
  }

  async reloadSubscription(
    companyId: string,
    systemId: string,
  ): Promise<Subscription | null> {
    const key = `${companyId}:${systemId}`;
    const cacheName = `sub:${key}`;

    if (!subscriptionKeys.has(cacheName)) {
      registerCache(
        CORE_SLUG,
        cacheName,
        () => loadSubscription(companyId, systemId),
      );
      subscriptionKeys.add(cacheName);
    }

    return updateCache<Subscription | null>(CORE_SLUG, cacheName);
  }

  async reload(): Promise<void> {
    await updateCache<CoreData>(CORE_SLUG, "data");
    this.missingSettings.clear();
    // JWT secret is derived from settings — clear so it re-reads from updated data
    clearCache(CORE_SLUG, "jwt-secret");
    clearCache(CORE_SLUG, "file-access");
  }

  evictAllSubscriptions(): void {
    for (const cacheName of subscriptionKeys) {
      clearCache(CORE_SLUG, cacheName);
    }
    subscriptionKeys.clear();
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
