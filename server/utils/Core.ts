import { clearCache, getCache, registerCache, updateCache } from "./cache.ts";
import { fetchCompanySystemTenantRow } from "../db/queries/tenants.ts";
import type { Tenant } from "@/src/contracts/tenant";
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
import {
  fetchActorResourceLimit,
  resolveRoleNames,
} from "../db/queries/tenants.ts";

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

// ── Default resource limit (zero/empty) ────────────────────────────────────

const ZERO_LIMITS: TenantResourceLimits = {
  roles: [],
  entityLimits: {},
  apiRateLimit: 0,
  storageLimitBytes: 0,
  fileCacheLimitBytes: 0,
  credits: 0,
  maxConcurrentDownloads: 0,
  maxConcurrentUploads: 0,
  maxDownloadBandwidthMB: 0,
  maxUploadBandwidthMB: 0,
  maxOperationCountByResourceKey: {},
  creditLimitByResourceKey: {},
  frontendDomains: [],
};

// ── File access ────────────────────────────────────────────────────────────

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

// ── Limit merging helpers ──────────────────────────────────────────────────

type RL = Record<string, unknown> | undefined;

function toRlNum(obj: RL, key: string, fallback = 0): number {
  return Number((obj as Record<string, number> | undefined)?.[key] ?? fallback);
}

function toRlStrArr(obj: RL, key: string): string[] {
  const v = (obj as Record<string, unknown> | undefined)?.[key];
  return Array.isArray(v) ? (v as string[]) : [];
}

function toRlRec(obj: RL, key: string): Record<string, number> {
  const v = (obj as Record<string, unknown> | undefined)?.[key];
  return (typeof v === "object" && v !== null)
    ? (v as Record<string, number>)
    : {};
}

function mergeEntityLimits(
  planRl: RL,
  voucherRl: RL,
): Record<string, number> {
  const plan = toRlRec(planRl, "entityLimits");
  const voucher = toRlRec(voucherRl, "entityLimits");
  const keys = new Set([...Object.keys(plan), ...Object.keys(voucher)]);
  const result: Record<string, number> = {};
  for (const k of keys) {
    const v = (plan[k] ?? 0) + (voucher[k] ?? 0);
    if (v > 0) result[k] = Math.max(0, v);
  }
  return result;
}

function mergeOperationCounts(
  planRl: RL,
  voucherRl: RL,
): Record<string, number> {
  const plan = toRlRec(planRl, "maxOperationCountByResourceKey");
  const voucher = toRlRec(voucherRl, "maxOperationCountByResourceKey");
  const keys = new Set([...Object.keys(plan), ...Object.keys(voucher)]);
  const result: Record<string, number> = {};
  for (const k of keys) {
    const v = (plan[k] ?? 0) + (voucher[k] ?? 0);
    if (v > 0) result[k] = Math.max(0, v);
  }
  return result;
}

function mergeCreditLimits(
  planRl: RL,
  voucherRl: RL,
): Record<string, number> {
  const plan = toRlRec(planRl, "creditLimitByResourceKey");
  const voucher = toRlRec(voucherRl, "creditLimitByResourceKey");
  const keys = new Set([...Object.keys(plan), ...Object.keys(voucher)]);
  const result: Record<string, number> = {};
  for (const k of keys) {
    const v = (plan[k] ?? 0) + (voucher[k] ?? 0);
    if (v > 0) result[k] = Math.max(0, v);
  }
  return result;
}

async function mergeLimits(
  planRl: RL,
  voucherRl: RL,
): Promise<TenantResourceLimits> {
  const planRoleIds = toRlStrArr(planRl, "roleIds");
  const voucherRoleIds = toRlStrArr(voucherRl, "roleIds");
  const allRoleIds = [...planRoleIds, ...voucherRoleIds];
  const roles = allRoleIds.length > 0 ? await resolveRoleNames(allRoleIds) : [];
  return {
    roles,
    entityLimits: mergeEntityLimits(planRl, voucherRl),
    apiRateLimit: Math.max(
      0,
      toRlNum(planRl, "apiRateLimit") + toRlNum(voucherRl, "apiRateLimit"),
    ),
    storageLimitBytes: Math.max(
      0,
      toRlNum(planRl, "storageLimitBytes") +
        toRlNum(voucherRl, "storageLimitBytes"),
    ),
    fileCacheLimitBytes: Math.max(
      0,
      toRlNum(planRl, "fileCacheLimitBytes") +
        toRlNum(voucherRl, "fileCacheLimitBytes"),
    ),
    credits: Math.max(
      0,
      toRlNum(planRl, "credits") + toRlNum(voucherRl, "credits"),
    ),
    maxConcurrentDownloads: Math.max(
      0,
      toRlNum(planRl, "maxConcurrentDownloads") +
        toRlNum(voucherRl, "maxConcurrentDownloads"),
    ),
    maxConcurrentUploads: Math.max(
      0,
      toRlNum(planRl, "maxConcurrentUploads") +
        toRlNum(voucherRl, "maxConcurrentUploads"),
    ),
    maxDownloadBandwidthMB: Math.max(
      0,
      toRlNum(planRl, "maxDownloadBandwidthMB") +
        toRlNum(voucherRl, "maxDownloadBandwidthMB"),
    ),
    maxUploadBandwidthMB: Math.max(
      0,
      toRlNum(planRl, "maxUploadBandwidthMB") +
        toRlNum(voucherRl, "maxUploadBandwidthMB"),
    ),
    maxOperationCountByResourceKey: mergeOperationCounts(planRl, voucherRl),
    creditLimitByResourceKey: mergeCreditLimits(planRl, voucherRl),
    frontendDomains: [
      ...toRlStrArr(planRl, "frontendDomains"),
      ...toRlStrArr(voucherRl, "frontendDomains"),
    ],
  };
}

/**
 * Clamp actor-level limits by company+system merged limits.
 * 0 means unlimited — a 0 in the company+system limit does not clamp.
 */
function clampLimits(
  actor: TenantResourceLimits,
  cs: TenantResourceLimits,
): TenantResourceLimits {
  const clamp = (actorVal: number, csVal: number): number => {
    if (csVal === 0) return actorVal;
    if (actorVal === 0) return csVal;
    return Math.min(actorVal, csVal);
  };

  return {
    roles: actor.roles,
    entityLimits: clampRecord(actor.entityLimits, cs.entityLimits),
    apiRateLimit: clamp(actor.apiRateLimit, cs.apiRateLimit),
    storageLimitBytes: clamp(actor.storageLimitBytes, cs.storageLimitBytes),
    fileCacheLimitBytes: clamp(
      actor.fileCacheLimitBytes,
      cs.fileCacheLimitBytes,
    ),
    credits: clamp(actor.credits, cs.credits),
    maxConcurrentDownloads: clamp(
      actor.maxConcurrentDownloads,
      cs.maxConcurrentDownloads,
    ),
    maxConcurrentUploads: clamp(
      actor.maxConcurrentUploads,
      cs.maxConcurrentUploads,
    ),
    maxDownloadBandwidthMB: clamp(
      actor.maxDownloadBandwidthMB,
      cs.maxDownloadBandwidthMB,
    ),
    maxUploadBandwidthMB: clamp(
      actor.maxUploadBandwidthMB,
      cs.maxUploadBandwidthMB,
    ),
    maxOperationCountByResourceKey: clampRecord(
      actor.maxOperationCountByResourceKey,
      cs.maxOperationCountByResourceKey,
    ),
    creditLimitByResourceKey: clampRecord(
      actor.creditLimitByResourceKey,
      cs.creditLimitByResourceKey,
    ),
    frontendDomains: actor.frontendDomains,
  };
}

function clampRecord(
  actor: Record<string, number>,
  cs: Record<string, number>,
): Record<string, number> {
  const keys = new Set([...Object.keys(actor), ...Object.keys(cs)]);
  const result: Record<string, number> = {};
  for (const k of keys) {
    const actorVal = actor[k] ?? 0;
    const csVal = cs[k] ?? 0;
    if (csVal === 0) {
      result[k] = actorVal;
    } else if (actorVal === 0) {
      result[k] = csVal;
    } else {
      result[k] = Math.min(actorVal, csVal);
    }
  }
  return result;
}

// ── Core data loading ──────────────────────────────────────────────────────

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
  private tenantLimitsRegistered: Set<string> = new Set();
  private actorLimitsRegistered: Set<string> = new Set();
  private rolesRegistered: Set<string> = new Set();

  private constructor() {}

  static getInstance(): Core {
    if (!Core.instance) {
      Core.instance = new Core();
    }
    return Core.instance;
  }

  // ── File access ────────────────────────────────────────────────────────

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

  // ── Settings ───────────────────────────────────────────────────────────

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

  async refreshSettingsScope(scopeKey: string): Promise<void> {
    const cacheName = `settings:${scopeKey}`;
    if (trackedScopes.has(scopeKey)) {
      await updateCache(SETTINGS_SLUG, cacheName);
    }
  }

  async getMissingSettings(): Promise<MissingSetting[]> {
    return Array.from(this.missingSettings.values());
  }

  // ── System / role / plan / menu accessors ──────────────────────────────

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

  // ── Derived accessors (no DB — pure CoreData lookups) ──────────────────

  /** Resolves systemSlug from the pre-loaded systemsById cache. */
  async getSystemSlug(systemId: string): Promise<string | undefined> {
    const data = await getCache<CoreData>(CORE_SLUG, "data");
    return data.systemsById.get(systemId)?.slug;
  }

  /** Derives actorType from the actorId prefix — no DB needed. */
  static deriveActorType(
    actorId?: string,
  ): "user" | "api_token" | undefined {
    if (!actorId) return undefined;
    if (actorId.startsWith("api_token:")) return "api_token";
    if (actorId.startsWith("user:")) return "user";
    return undefined;
  }

  // ── Subscription caching ───────────────────────────────────────────────

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
    tenant: Tenant,
  ): Promise<Subscription | null> {
    const { fetchCompanySystemTenantRow } = await import(
      "../db/queries/tenants.ts"
    );
    const tenantRow = await fetchCompanySystemTenantRow(
      tenant.companyId!,
      tenant.systemId!,
    );
    if (!tenantRow) return null;
    return this.reloadSubscription(tenantRow.id);
  }

  // ── Tenant resource limits (plan + voucher merged, per company+system) ──

  /**
   * Lazily loads and caches the merged plan+voucher resource_limit for a
   * company+system. Cache key: limits:{systemId}:{companyId}.
   * Internally resolves the tenant row → subscription → plan+voucher limits.
   */
  async ensureTenantLimits(
    tenant: Tenant,
  ): Promise<TenantResourceLimits> {
    const cacheName = `tenantLimits:${tenant.systemId}:${tenant.companyId}`;

    if (!this.tenantLimitsRegistered.has(cacheName)) {
      registerCache(
        CORE_SLUG,
        cacheName,
        () => this.loadTenantLimits(tenant),
      );
      this.tenantLimitsRegistered.add(cacheName);
    }

    return getCache<TenantResourceLimits>(CORE_SLUG, cacheName);
  }

  async reloadTenantLimits(
    tenant: Tenant,
  ): Promise<TenantResourceLimits> {
    const cacheName = `tenantLimits:${tenant.systemId}:${tenant.companyId}`;
    if (!this.tenantLimitsRegistered.has(cacheName)) {
      registerCache(
        CORE_SLUG,
        cacheName,
        () => this.loadTenantLimits(tenant),
      );
      this.tenantLimitsRegistered.add(cacheName);
    }
    return updateCache<TenantResourceLimits>(CORE_SLUG, cacheName);
  }

  private async loadTenantLimits(
    tenant: Tenant,
  ): Promise<TenantResourceLimits> {
    const row = await fetchCompanySystemTenantRow(
      tenant.companyId!,
      tenant.systemId!,
    );
    if (!row) return { ...ZERO_LIMITS };

    const sub = await this.ensureSubscription(row.id);
    if (!sub) return { ...ZERO_LIMITS };

    const plan = sub.planId
      ? await this.getPlanById(String(sub.planId))
      : undefined;
    const voucher = sub.voucherId
      ? await this.getVoucherById(String(sub.voucherId))
      : undefined;

    const planRl = plan?.resourceLimitId as RL;
    const voucherRl = voucher?.resourceLimitId as RL;

    if (!planRl && !voucherRl) return { ...ZERO_LIMITS };

    return await mergeLimits(planRl, voucherRl);
  }

  // ── Actor resource limits (clamped by tenant limits) ──────────────────

  /**
   * Lazily loads the actor's resource_limit, clamped by the company+system
   * merged limits. Cache key: actorLimits:{systemId}:{companyId}:{actorId}.
   * 0 in the CS limit means unlimited → no clamp on that field.
   */
  async ensureActorLimits(
    tenant: Tenant,
  ): Promise<TenantResourceLimits> {
    const cacheName =
      `actorLimits:${tenant.systemId}:${tenant.companyId}:${tenant.actorId}`;

    if (!this.actorLimitsRegistered.has(cacheName)) {
      registerCache(
        CORE_SLUG,
        cacheName,
        () => this.loadActorLimits(tenant),
      );
      this.actorLimitsRegistered.add(cacheName);
    }

    return getCache<TenantResourceLimits>(CORE_SLUG, cacheName);
  }

  async reloadActorLimits(
    tenant: Tenant,
  ): Promise<TenantResourceLimits> {
    const cacheName =
      `actorLimits:${tenant.systemId}:${tenant.companyId}:${tenant.actorId}`;
    if (!this.actorLimitsRegistered.has(cacheName)) {
      registerCache(
        CORE_SLUG,
        cacheName,
        () => this.loadActorLimits(tenant),
      );
      this.actorLimitsRegistered.add(cacheName);
    }
    return updateCache<TenantResourceLimits>(CORE_SLUG, cacheName);
  }

  private async loadActorLimits(
    tenant: Tenant,
  ): Promise<TenantResourceLimits> {
    const csLimits = await this.ensureTenantLimits(tenant);
    const actorRlRaw = await fetchActorResourceLimit(tenant.actorId!);

    if (!actorRlRaw) {
      return { ...csLimits };
    }

    const actorRl: RL = actorRlRaw;
    const actorLimits = {
      roles: toRlStrArr(actorRl, "roleIds"),
      entityLimits: toRlRec(actorRl, "entityLimits"),
      apiRateLimit: toRlNum(actorRl, "apiRateLimit"),
      storageLimitBytes: toRlNum(actorRl, "storageLimitBytes"),
      fileCacheLimitBytes: toRlNum(actorRl, "fileCacheLimitBytes"),
      credits: toRlNum(actorRl, "credits"),
      maxConcurrentDownloads: toRlNum(actorRl, "maxConcurrentDownloads"),
      maxConcurrentUploads: toRlNum(actorRl, "maxConcurrentUploads"),
      maxDownloadBandwidthMB: toRlNum(actorRl, "maxDownloadBandwidthMB"),
      maxUploadBandwidthMB: toRlNum(actorRl, "maxUploadBandwidthMB"),
      maxOperationCountByResourceKey: toRlRec(
        actorRl,
        "maxOperationCountByResourceKey",
      ),
      creditLimitByResourceKey: toRlRec(actorRl, "creditLimitByResourceKey"),
      frontendDomains: toRlStrArr(actorRl, "frontendDomains"),
    };

    return clampLimits(actorLimits, csLimits);
  }

  // ── Role resolution ────────────────────────────────────────────────────

  /**
   * Resolves role names for an actor from resource_limit.roleIds →
   * role record IDs → role names. Cached per actorId.
   */
  async getTenantRoles(tenant: Tenant): Promise<string[]> {
    if (!tenant.actorId) return [];

    const cacheName = `roles:${tenant.actorId}`;

    if (!this.rolesRegistered.has(cacheName)) {
      registerCache(CORE_SLUG, cacheName, async () => {
        const rl = await fetchActorResourceLimit(tenant.actorId!);
        const roleIds = toRlStrArr(rl ?? undefined, "roleIds");
        if (!roleIds.length) return [] as string[];
        return resolveRoleNames(roleIds);
      });
      this.rolesRegistered.add(cacheName);
    }

    return getCache<string[]>(CORE_SLUG, cacheName);
  }

  async reloadTenantRoles(tenant: Tenant): Promise<string[]> {
    const cacheName = `roles:${tenant.actorId}`;
    if (!tenant.actorId) return [];
    // Re-register if needed
    if (!this.rolesRegistered.has(cacheName)) {
      registerCache(CORE_SLUG, cacheName, async () => {
        const rl = await fetchActorResourceLimit(tenant.actorId!);
        const roleIds = toRlStrArr(rl ?? undefined, "roleIds");
        if (!roleIds.length) return [] as string[];
        return resolveRoleNames(roleIds);
      });
      this.rolesRegistered.add(cacheName);
    }
    return updateCache<string[]>(CORE_SLUG, cacheName);
  }

  // ── Frontend domains ───────────────────────────────────────────────────

  async getFrontendDomains(tenant: Tenant): Promise<string[]> {
    if (tenant.actorId) {
      const limits = await this.ensureActorLimits(tenant);
      if (limits.frontendDomains.length > 0) {
        return limits.frontendDomains;
      }
    }
    const csLimits = await this.ensureTenantLimits(tenant);
    return csLimits.frontendDomains;
  }

  // ── Reload ─────────────────────────────────────────────────────────────

  async reload(): Promise<void> {
    await updateCache<CoreData>(CORE_SLUG, "data");
    this.missingSettings.clear();
    clearCache(CORE_SLUG, "jwt-secret");
    clearCache(CORE_SLUG, "anonymous-jwt");
    clearCache(CORE_SLUG, "file-access");

    // Clear limit and role caches
    for (const cacheName of this.tenantLimitsRegistered) {
      clearCache(CORE_SLUG, cacheName);
    }
    this.tenantLimitsRegistered.clear();
    for (const cacheName of this.actorLimitsRegistered) {
      clearCache(CORE_SLUG, cacheName);
    }
    this.actorLimitsRegistered.clear();
    for (const cacheName of this.rolesRegistered) {
      clearCache(CORE_SLUG, cacheName);
    }
    this.rolesRegistered.clear();

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

    // Also evict related limit caches
    for (const cacheName of this.tenantLimitsRegistered) {
      clearCache(CORE_SLUG, cacheName);
    }
    this.tenantLimitsRegistered.clear();
    for (const cacheName of this.actorLimitsRegistered) {
      clearCache(CORE_SLUG, cacheName);
    }
    this.actorLimitsRegistered.clear();
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
