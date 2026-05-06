import "server-only";

import { cacheTag, revalidateTag } from "next/cache";
import {
  JsonValue,
  LayerMerger,
  NormalizedTenant,
  OwnLayer,
  RawLayer,
  ResolvedLayer,
  RevalidationMode,
  SettingValue,
} from "@/src/contracts/high-level/cache";
import { Tenant } from "@/src/contracts/tenant";
import {
  buildMenuTree,
  buildScopeKey,
  compilePattern,
  deriveActorType,
  limitsMerger,
  readActorFromSource,
  readCompanyFromSource,
  readGlobalFromSource,
  readSystemFromSource,
} from "./cache-helper.ts";

export {
  buildMenuTree,
  buildScopeKey,
  compilePattern,
  deriveActorType,
  limitsMerger,
};

/**
 * =============================================================================
 * GLOBAL CACHE FOR MULTI-TENANT SETTINGS
 * =============================================================================
 *
 * Public read methods:
 *
 *   get(tenant, key, merge?)
 *
 * Public update methods for Server Actions:
 *
 *   updateTenantCache(tenant?, key?)
 *
 * Public revalidation methods for Route Handlers / webhooks / jobs:
 *
 *   revalidateTenantCache(tenant?, key?, mode?)
 *
 * =============================================================================
 * CACHE RESOLUTION ALGORITHM
 * =============================================================================
 *
 * Cached functions return RawLayer (raw data + dependency hash, NO composition).
 * $tenantSetting composes level-by-level using the merge function.
 *
 * Default merge = deepMerge for objects, override for primitives/arrays.
 * Custom merge (e.g. limitsMerger) can pass data through levels without
 * composing, accumulating raw data for final resolution.
 *
 * =============================================================================
 * WHY dependencyKey EXISTS
 * =============================================================================
 *
 * Next cache entries are keyed by the cached function and its arguments.
 *
 * A child cache must change when its parent changes.
 *
 * Better approach used here:
 *
 *   global changed -> only invalidate global cache
 *
 * Then, on the next request:
 *
 *   global.dependencyKey changes
 *   system cache receives a new parentDependencyKey argument
 *   company cache receives a new parentDependencyKey argument
 *   actor cache receives a new parentDependencyKey argument
 *
 * Therefore children lazily move to new cache entries without explicit
 * descendant invalidation.
 */

const TAG_PREFIX = "core-cache";

const TENANT_GLOBAL_SETTING_TAG = `${TAG_PREFIX}:tenant-global-setting`;
const SYSTEM_SETTING_TAG = `${TAG_PREFIX}:system-setting`;
const COMPANY_SETTING_TAG = `${TAG_PREFIX}:company-setting`;
const ACTOR_SETTING_TAG = `${TAG_PREFIX}:actor-setting`;

/**
 * =============================================================================
 * PUBLIC READ API
 * =============================================================================
 */

/**
 * Reads a tenant setting.
 *
 * tenant can be:
 *
 *   undefined / {}  → global tenant scope
 *   { systemId }    → system scope
 *   { systemId, companyId }       → company scope
 *   { systemId, companyId, actorId } → actor scope
 *
 * merge: optional LayerMerger for custom composition across hierarchy levels.
 */
export async function get(
  tenant: Tenant | undefined,
  key: string,
  merge?: LayerMerger,
): Promise<SettingValue | undefined> {
  return unwrap(await $tenantSetting(tenant, key, merge));
}

/**
 * =============================================================================
 * PUBLIC UPDATE API
 * =============================================================================
 */

export function updateTenantCache(
  tenant?: Tenant,
  key?: string,
): void {
  const normalized = normalizeTenant(tenant);
  revalidateTag(tenantInvalidationTag(normalized, key), { expire: 0 });
}

/**
 * =============================================================================
 * PUBLIC REVALIDATION API
 * =============================================================================
 */

export function revalidateTenantCache(
  tenant?: Tenant,
  key?: string,
  mode: RevalidationMode = "lazy",
): void {
  const normalized = normalizeTenant(tenant);
  revalidate(tenantInvalidationTag(normalized, key), mode);
}

/**
 * =============================================================================
 * PRIVATE COMPOSITION ENGINE
 * =============================================================================
 */

const defaultMerger: LayerMerger = (
  parent: ResolvedLayer,
  child: RawLayer,
): ResolvedLayer => {
  if (!child.found) return parent;
  if (!parent.found) {
    return {
      found: true,
      value: child.value,
      dependencyKey: child.dependencyKey,
    };
  }

  if (isPlainObject(parent.value) && isPlainObject(child.value)) {
    return {
      found: true,
      value: deepMerge(parent.value, child.value),
      dependencyKey: child.dependencyKey,
    };
  }

  return {
    found: true,
    value: child.value,
    dependencyKey: child.dependencyKey,
  };
};

async function $tenantSetting(
  tenant: Tenant | undefined,
  key: string,
  merge?: LayerMerger,
): Promise<ResolvedLayer> {
  const normalized = normalizeTenant(tenant);
  const settingKey = normalizeKey(key);
  const merger = merge ?? defaultMerger;

  const globalRaw = await cachedTenantGlobalSetting(settingKey);
  let resolved: ResolvedLayer = merger(
    { found: false, dependencyKey: "root" },
    globalRaw,
  );

  if (normalized.level === "global") return resolved;

  const systemRaw = await cachedSystemSetting(
    normalized.systemId,
    settingKey,
    resolved.dependencyKey,
  );
  resolved = merger(resolved, systemRaw);

  if (normalized.level === "system") return resolved;

  const companyRaw = await cachedCompanySetting(
    normalized.systemId,
    normalized.companyId,
    settingKey,
    resolved.dependencyKey,
  );
  resolved = merger(resolved, companyRaw);

  if (normalized.level === "company") return resolved;

  const actorRaw = await cachedActorSetting(
    normalized.systemId,
    normalized.companyId,
    normalized.actorId,
    settingKey,
    resolved.dependencyKey,
  );
  return merger(resolved, actorRaw);
}

/**
 * =============================================================================
 * PRIVATE CACHED FUNCTIONS
 * =============================================================================
 *
 * Each returns RawLayer — raw OwnLayer data + computed dependencyKey.
 * NO composition inside cached functions. Composition is done by $tenantSetting.
 */

async function cachedTenantGlobalSetting(
  key: string,
): Promise<RawLayer> {
  "use cache: remote";

  cacheTag(
    TENANT_GLOBAL_SETTING_TAG,
    tenantGlobalTag(),
    tenantGlobalKeyTag(key),
  );

  const own = await readGlobalFromSource(key);

  const dependencyKey = await dependencyHash({
    type: "root",
    level: "tenant-global",
    key,
    ownToken: ownToken(own),
  });

  return JSON.parse(JSON.stringify({ ...own, dependencyKey })) as RawLayer;
}

async function cachedSystemSetting(
  systemId: string,
  key: string,
  parentDependencyKey: string,
): Promise<RawLayer> {
  "use cache: remote";

  cacheTag(
    SYSTEM_SETTING_TAG,
    systemTag(systemId),
    systemKeyTag(systemId, key),
  );

  const own = await readSystemFromSource(systemId, key);

  const dependencyKey = await dependencyHash({
    type: "child",
    level: "system",
    key,
    parentDependencyKey,
    ownToken: ownToken(own),
  });

  return JSON.parse(JSON.stringify({ ...own, dependencyKey })) as RawLayer;
}

async function cachedCompanySetting(
  systemId: string,
  companyId: string,
  key: string,
  parentDependencyKey: string,
): Promise<RawLayer> {
  "use cache: remote";

  cacheTag(
    COMPANY_SETTING_TAG,
    companyTag(systemId, companyId),
    companyKeyTag(systemId, companyId, key),
  );

  const own = await readCompanyFromSource(systemId, companyId, key);

  const dependencyKey = await dependencyHash({
    type: "child",
    level: "company",
    key,
    parentDependencyKey,
    ownToken: ownToken(own),
  });

  return JSON.parse(JSON.stringify({ ...own, dependencyKey })) as RawLayer;
}

async function cachedActorSetting(
  systemId: string,
  companyId: string,
  actorId: string,
  key: string,
  parentDependencyKey: string,
): Promise<RawLayer> {
  "use cache: remote";

  cacheTag(
    ACTOR_SETTING_TAG,
    actorTag(systemId, companyId, actorId),
    actorKeyTag(systemId, companyId, actorId, key),
  );

  const own = await readActorFromSource(
    systemId,
    companyId,
    actorId,
    key,
  );

  const dependencyKey = await dependencyHash({
    type: "child",
    level: "actor",
    key,
    parentDependencyKey,
    ownToken: ownToken(own),
  });

  return JSON.parse(JSON.stringify({ ...own, dependencyKey })) as RawLayer;
}

/**
 * =============================================================================
 * UNWRAP
 * =============================================================================
 */

function unwrap(layer: ResolvedLayer): SettingValue | undefined {
  return layer.found ? layer.value : undefined;
}

/**
 * =============================================================================
 * TENANT VALIDATION
 * =============================================================================
 */

function normalizeTenant(tenant?: Tenant): NormalizedTenant {
  const systemId = normalizeOptionalId(tenant?.systemId);
  const companyId = normalizeOptionalId(tenant?.companyId);
  const actorId = normalizeOptionalId(tenant?.actorId);

  if (!systemId && !companyId && !actorId) {
    return { level: "global" };
  }

  if (!systemId) {
    throw new Error(
      "Invalid tenant: companyId or actorId cannot be used without systemId.",
    );
  }

  if (actorId && !companyId) {
    throw new Error(
      "Invalid tenant: actorId requires companyId.",
    );
  }

  if (actorId) {
    return { level: "actor", systemId, companyId: companyId!, actorId };
  }

  if (companyId) {
    return { level: "company", systemId, companyId };
  }

  return { level: "system", systemId };
}

function normalizeKey(key: string): string {
  const normalized = key.trim();
  if (!normalized) throw new Error("Invalid setting key: key cannot be empty.");
  return normalized;
}

function normalizeOptionalId(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

/**
 * =============================================================================
 * CACHE TAG BUILDERS
 * =============================================================================
 */

function tenantInvalidationTag(
  tenant: NormalizedTenant,
  key?: string,
): string {
  const normalizedKey = key ? normalizeKey(key) : undefined;

  if (tenant.level === "global") {
    return normalizedKey
      ? tenantGlobalKeyTag(normalizedKey)
      : tenantGlobalTag();
  }

  if (tenant.level === "system") {
    return normalizedKey
      ? systemKeyTag(tenant.systemId, normalizedKey)
      : systemTag(tenant.systemId);
  }

  if (tenant.level === "company") {
    return normalizedKey
      ? companyKeyTag(tenant.systemId, tenant.companyId, normalizedKey)
      : companyTag(tenant.systemId, tenant.companyId);
  }

  return normalizedKey
    ? actorKeyTag(
      tenant.systemId,
      tenant.companyId,
      tenant.actorId,
      normalizedKey,
    )
    : actorTag(tenant.systemId, tenant.companyId, tenant.actorId);
}

function tenantGlobalTag(): string {
  return tag(TENANT_GLOBAL_SETTING_TAG, "global");
}

function tenantGlobalKeyTag(key: string): string {
  return tag(TENANT_GLOBAL_SETTING_TAG, "global", "key", key);
}

function systemTag(systemId: string): string {
  return tag(SYSTEM_SETTING_TAG, "system", systemId);
}

function systemKeyTag(systemId: string, key: string): string {
  return tag(SYSTEM_SETTING_TAG, "system", systemId, "key", key);
}

function companyTag(systemId: string, companyId: string): string {
  return tag(COMPANY_SETTING_TAG, "system", systemId, "company", companyId);
}

function companyKeyTag(
  systemId: string,
  companyId: string,
  key: string,
): string {
  return tag(
    COMPANY_SETTING_TAG,
    "system",
    systemId,
    "company",
    companyId,
    "key",
    key,
  );
}

function actorTag(
  systemId: string,
  companyId: string,
  actorId: string,
): string {
  return tag(
    ACTOR_SETTING_TAG,
    "system",
    systemId,
    "company",
    companyId,
    "actor",
    actorId,
  );
}

function actorKeyTag(
  systemId: string,
  companyId: string,
  actorId: string,
  key: string,
): string {
  return tag(
    ACTOR_SETTING_TAG,
    "system",
    systemId,
    "company",
    companyId,
    "actor",
    actorId,
    "key",
    key,
  );
}

function tag(...parts: string[]): string {
  const value = parts.map(encodeURIComponent).join(":");
  if (value.length > 256) {
    throw new Error(
      `Cache tag is too long (${value.length} chars).`,
    );
  }
  return value;
}

function revalidate(tag: string, mode: RevalidationMode): void {
  if (mode === "blocking") {
    revalidateTag(tag, { expire: 0 });
    return;
  }
  revalidateTag(tag, "max");
}

/**
 * =============================================================================
 * WEB-STANDARD HASHING
 * =============================================================================
 */

function ownToken(own: OwnLayer): string {
  return own.found ? `found:${own.revision}` : `missing:${own.revision}`;
}

async function dependencyHash(value: unknown): Promise<string> {
  const input = stableStringify(value);
  const bytes = new TextEncoder().encode(input);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return arrayBufferToHex(digest);
}

function arrayBufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

function stableStringify(value: unknown): string {
  if (value === null) return "null";
  if (typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const object = value as Record<string, unknown>;
  return `{${
    Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
      .join(",")
  }}`;
}

/**
 * =============================================================================
 * MERGE HELPERS
 * =============================================================================
 */

function isPlainObject(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMerge(
  parent: Record<string, JsonValue>,
  child: Record<string, JsonValue>,
): Record<string, JsonValue> {
  const output: Record<string, JsonValue> = { ...parent };

  for (const [key, childValue] of Object.entries(child)) {
    const parentValue = output[key];

    if (isPlainObject(parentValue) && isPlainObject(childValue)) {
      output[key] = deepMerge(parentValue, childValue);
      continue;
    }

    output[key] = childValue;
  }

  return output;
}
