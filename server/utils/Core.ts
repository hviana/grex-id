import { clearCache, getCache, registerCache, updateCache } from "./cache.ts";
import type { System } from "@/src/contracts/system";
import type { Role } from "@/src/contracts/role";
import type { Plan } from "@/src/contracts/plan";
import type { MenuItem } from "@/src/contracts/menu";
import type { CoreSetting } from "@/src/contracts/core-settings";
import type { Voucher } from "@/src/contracts/voucher";
import type { Subscription } from "@/src/contracts/billing";
import type {
  FileAccessSection,
  FileAccessUploadSection,
} from "@/src/contracts/file-access";
import dbConfig from "../../database.json" with { type: "json" };
import { assertServerOnly } from "./server-only.ts";
import {
  buildScopeKey,
  fetchActiveSubscription,
  fetchAllCoreData,
  loadSettingsForScope,
  resolveScopeChain,
  type SettingScope,
} from "../db/queries/core-settings.ts";
import { genericList } from "../db/queries/generics.ts";

assertServerOnly("Core");

export type { SettingScope };
export { buildScopeKey };

/** Pre-computed merged resource limits (plan + voucher) cached per tenant. */
export interface TenantResourceLimits {
  roles: string[];
  entityLimits: Record<string, number>;
  apiRateLimit: number;
  storageLimitBytes: number;
  fileCacheLimitBytes: number;
  credits: number;
  maxConcurrentDownloads: number;
  maxConcurrentUploads: number;
  maxDownloadBandwidthMB: number;
  maxUploadBandwidthMB: number;
  maxOperationCountByResourceKey: Record<string, number>;
  creditLimitByResourceKey: Record<string, number>;
  frontendDomains: string[];
}

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
  systemsBySlug: Map<string, System>;
  systemsById: Map<string, System>;
  rolesBySystem: Map<string, Role[]>;
  plansBySystem: Map<string, Plan[]>;
  menusBySystem: Map<string, MenuItem[]>;
  plansById: Map<string, Plan>;
  vouchersById: Map<string, Voucher>;
}

export interface CompiledFileAccess {
  id: string;
  name: string;
  categoryPattern: string;
  compiledPattern: RegExp;
  download: FileAccessSection;
  upload: FileAccessUploadSection;
}

export interface FileAccessCacheData {
  rules: CompiledFileAccess[];
}

const defaultSection: FileAccessSection = {
  isolateSystem: false,
  isolateCompany: false,
  isolateUser: false,
  roles: [],
};

const defaultUploadSection: FileAccessUploadSection = {
  ...defaultSection,
  maxFileSizeMB: undefined,
  allowedExtensions: [],
};

function normalizeSection(
  raw: Partial<FileAccessSection> | undefined,
): FileAccessSection {
  if (!raw) return { ...defaultSection };
  return {
    isolateSystem: !!raw.isolateSystem,
    isolateCompany: !!raw.isolateCompany,
    isolateUser: !!raw.isolateUser,
    roles: Array.isArray(raw.roles) ? raw.roles : [],
  };
}

function normalizeUploadSection(
  raw: Partial<FileAccessUploadSection> | undefined,
): FileAccessUploadSection {
  if (!raw) return { ...defaultUploadSection };
  return {
    ...normalizeSection(raw),
    maxFileSizeMB: raw.maxFileSizeMB !== undefined && raw.maxFileSizeMB !== null
      ? Number(raw.maxFileSizeMB)
      : undefined,
    allowedExtensions: Array.isArray(raw.allowedExtensions)
      ? raw.allowedExtensions.map(String)
      : [],
  };
}

export function compilePattern(pattern: string): RegExp {
  let normalized = pattern.trim();
  if (normalized.startsWith("/")) normalized = normalized.slice(1);
  if (normalized.endsWith("/")) normalized = normalized.slice(0, -1);

  const segments = normalized.split("/");
  const regexParts = segments.map((seg) => {
    const escaped = seg.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    return escaped.replace(/\*/g, "[^/]+");
  });

  return new RegExp("^" + regexParts.join("/") + "$");
}

async function loadFileAccessData(): Promise<FileAccessCacheData> {
  const { items: records } = await genericList({
    table: "file_access",
    orderBy: "createdAt",
    limit: 1000,
  });

  const rules: CompiledFileAccess[] = records.map((r) => ({
    id: String(r.id),
    name: String(r.name ?? ""),
    categoryPattern: String(r.categoryPattern ?? ""),
    compiledPattern: compilePattern(String(r.categoryPattern ?? "")),
    download: normalizeSection(
      r.download as Partial<FileAccessSection> | undefined,
    ),
    upload: normalizeUploadSection(
      r.upload as Partial<FileAccessUploadSection> | undefined,
    ),
  }));

  console.log(`[Core] loaded ${rules.length} file access rules`);
  return { rules };
}

const CORE_SLUG = "core";
const SETTINGS_SLUG = "core-settings";

export async function loadCoreData(): Promise<CoreData> {
  const results = await fetchAllCoreData();

  const systems = results[0] ?? [];
  const roles = results[1] ?? [];
  const plans = results[2] ?? [];
  const menus = results[3] ?? [];
  const vouchers = results[4] ?? [];

  const systemsBySlug = new Map<string, System>();
  const systemsById = new Map<string, System>();
  for (const s of systems) {
    systemsBySlug.set(s.slug, s);
    systemsById.set(s.id, s);
  }

  const rolesBySystem = new Map<string, Role[]>();
  for (const r of roles) {
    const raw = (r as unknown as Record<string, unknown>).tenantIds;
    const key = String(Array.isArray(raw) ? raw[0] : raw);
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
    const raw = (p as unknown as Record<string, unknown>).tenantIds;
    const sysKey = String(Array.isArray(raw) ? raw[0] : raw);
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
    const raw = (m as unknown as Record<string, unknown>).tenantIds;
    const key = String(Array.isArray(raw) ? raw[0] : raw);
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

  console.log(
    `[Core] loaded: ${systems.length} systems, ${roles.length} roles, ${plans.length} plans, ${vouchers.length} vouchers, ${menus.length} menus`,
  );

  return {
    systems,
    roles,
    plans,
    vouchers,
    menus,
    systemsBySlug,
    systemsById,
    rolesBySystem,
    plansBySystem,
    menusBySystem,
    plansById,
    vouchersById,
  };
}

async function loadSubscription(
  tenantId: string,
): Promise<Subscription | null> {
  const rows = await fetchActiveSubscription({ tenantId });
  return rows[0] ?? null;
}

const subscriptionKeys: Set<string> = new Set();
const trackedScopes: Set<string> = new Set();

class Core {
  static readonly DB_URL = dbConfig.url;
  static readonly DB_USER = dbConfig.user;
  static readonly DB_PASS = dbConfig.pass;
  static readonly DB_NAMESPACE = dbConfig.namespace;
  static readonly DB_DATABASE = dbConfig.database;

  private static instance: Core | null = null;
  private missingSettings: Map<string, MissingSetting> = new Map();
  private fileAccessLoaded = false;
  private limitsRegistered: Set<string> = new Set();
  private rolesRegistered: Set<string> = new Set();
  private actorLimitsRegistered: Set<string> = new Set();

  private constructor() {}

  static getInstance(): Core {
    if (!Core.instance) {
      Core.instance = new Core();
    }
    return Core.instance;
  }

  private ensureFileAccessRegistered(): void {
    if (this.fileAccessLoaded) return;
    registerCache(CORE_SLUG, "file-access", loadFileAccessData);
    this.fileAccessLoaded = true;
  }

  async getFileAccessRules(): Promise<CompiledFileAccess[]> {
    this.ensureFileAccessRegistered();
    const data = await getCache<FileAccessCacheData>(CORE_SLUG, "file-access");
    return data.rules;
  }

  async reloadFileAccess(): Promise<void> {
    this.ensureFileAccessRegistered();
    await updateCache(CORE_SLUG, "file-access");
  }

  /**
   * Retrieves a setting value by walking the scope hierarchy:
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
      console.warn(`[Core] setting "${key}" not defined`);
    }

    return undefined;
  }

  /**
   * Loads settings for a specific scopeKey, using the cache registry.
   * Registers the cache entry lazily on first access.
   */
  private async getOrLoadScope(
    scopeKey: string,
  ): Promise<Map<string, CoreSetting>> {
    const cacheName = `settings:${scopeKey}`;

    if (!trackedScopes.has(scopeKey)) {
      registerCache(
        SETTINGS_SLUG,
        cacheName,
        () => loadSettingsForScope(scopeKey),
      );
      trackedScopes.add(scopeKey);
    }

    return getCache<Map<string, CoreSetting>>(SETTINGS_SLUG, cacheName);
  }

  /**
   * Refreshes a specific scope's settings cache after a mutation.
   */
  async refreshSettingsScope(scopeKey: string): Promise<void> {
    const cacheName = `settings:${scopeKey}`;
    if (trackedScopes.has(scopeKey)) {
      await updateCache(SETTINGS_SLUG, cacheName);
    }
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
    tenantId: string,
  ): Promise<Subscription | undefined> {
    const cacheName = `sub:${tenantId}`;
    try {
      return await getCache<Subscription>(CORE_SLUG, cacheName);
    } catch {
      return undefined;
    }
  }

  async ensureSubscription(
    tenantId: string,
  ): Promise<Subscription | null> {
    const cacheName = `sub:${tenantId}`;

    if (!subscriptionKeys.has(cacheName)) {
      registerCache(
        CORE_SLUG,
        cacheName,
        () => loadSubscription(tenantId),
      );
      subscriptionKeys.add(cacheName);
    }

    const cached = await getCache<Subscription | null>(CORE_SLUG, cacheName);
    return cached ?? null;
  }

  async reloadSubscription(
    tenantId: string,
  ): Promise<Subscription | null> {
    const cacheName = `sub:${tenantId}`;

    if (!subscriptionKeys.has(cacheName)) {
      registerCache(
        CORE_SLUG,
        cacheName,
        () => loadSubscription(tenantId),
      );
      subscriptionKeys.add(cacheName);
    }

    return updateCache<Subscription | null>(CORE_SLUG, cacheName);
  }

  /** @deprecated Use reloadSubscription(tenantId) instead */
  async reloadSubscriptionByScope(
    companyId: string,
    systemId: string,
  ): Promise<Subscription | null> {
    const { fetchCompanySystemTenantRow } = await import(
      "../db/queries/tenants.ts"
    );
    const tenantRow = await fetchCompanySystemTenantRow(companyId, systemId);
    if (!tenantRow) return null;
    return this.reloadSubscription(tenantRow.id);
  }

  async reload(): Promise<void> {
    await updateCache<CoreData>(CORE_SLUG, "data");
    this.missingSettings.clear();
    clearCache(CORE_SLUG, "jwt-secret");
    clearCache(CORE_SLUG, "anonymous-jwt");
    clearCache(CORE_SLUG, "file-access");

    // Refresh all loaded settings scopes
    for (const scopeKey of trackedScopes) {
      const cacheName = `settings:${scopeKey}`;
      try {
        await updateCache(SETTINGS_SLUG, cacheName);
      } catch {
        // Cache may not be registered yet; skip
      }
    }
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
