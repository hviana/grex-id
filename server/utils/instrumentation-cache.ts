import "server-only";

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
  readActorFromSource,
  readCompanyFromSource,
  readGlobalFromSource,
  readSystemFromSource,
} from "./cache-helper.ts";
/**
 * =============================================================================
 * IN-MEMORY CACHE FOR MULTI-TENANT SETTINGS
 * =============================================================================
 *
 * This file is the instrumentation-safe version of the regular tenant cache.
 *
 * It intentionally does NOT use:
 *
 *   - "use cache"
 *   - "use cache: remote"
 *   - cacheLife()
 *   - cacheTag()
 *   - revalidateTag()
 *   - cache profiles
 *   - TTL expiration
 *   - memory pruning
 *
 * Why:
 *
 *   instrumentation.ts runs outside the App Router / RSC cache lifecycle.
 *   Next.js cache APIs such as cacheTag() and cacheLife() require a real
 *   Cache Components execution context. instrumentation.ts does not have one.
 *
 * What this file does instead:
 *
 *   - Stores RawLayer entries in process memory.
 *   - Keeps an in-memory tag index that mirrors the tag structure of the
 *     regular Next.js cache file.
 *   - Preserves the same public API:
 *
 *       get(tenant, key, merge?)
 *       updateTenantCache(tenant?, key?)
 *       revalidateTenantCache(tenant?, key?, mode?)
 *
 *   - Preserves the same tenant hierarchy:
 *
 *       global -> system -> company -> actor
 *
 *   - Preserves the same parent dependency-key algorithm.
 *
 * =============================================================================
 * IMPORTANT LIMITATIONS
 * =============================================================================
 *
 * This cache is process-local.
 *
 * That means:
 *
 *   - It is lost when the server process restarts.
 *   - It is not shared across multiple server instances.
 *   - It is not shared across serverless cold starts.
 *   - It is not persisted.
 *   - It has no automatic TTL.
 *   - It has no automatic memory pruning.
 *
 * This is intentional because the goal is to make the cache usable from
 * instrumentation.ts without relying on Next.js Cache Components.
 *
 * If you need cross-instance invalidation, use a shared external cache or
 * database-backed cache.
 *
 * =============================================================================
 * CACHE RESOLUTION ALGORITHM
 * =============================================================================
 *
 * The cache does not store the final composed setting.
 *
 * Instead, it stores each hierarchy layer independently:
 *
 *   global raw layer
 *   system raw layer
 *   company raw layer
 *   actor raw layer
 *
 * Each layer returns RawLayer:
 *
 *   {
 *     found: boolean;
 *     value?: SettingValue;
 *     revision: string;
 *     dependencyKey: string;
 *   }
 *
 * $tenantSetting() composes the layers at read time using the selected merge
 * function.
 *
 * Why not cache the final resolved value?
 *
 *   Because different callers may pass different LayerMerger functions.
 *   Caching raw layers keeps the cache generic and keeps merge behavior outside
 *   the storage layer.
 *
 * =============================================================================
 * WHY dependencyKey EXISTS
 * =============================================================================
 *
 * Child cache keys include the parent dependencyKey.
 *
 * Example:
 *
 *   system cache key includes global.dependencyKey
 *   company cache key includes system.dependencyKey
 *   actor cache key includes company.dependencyKey
 *
 * This means parent changes naturally move descendants to new cache keys.
 *
 * Example:
 *
 *   1. A global setting changes.
 *   2. updateTenantCache({}, key) invalidates only the global layer.
 *   3. The next read reloads the global layer.
 *   4. The global dependencyKey changes.
 *   5. The system layer is requested with a new parentDependencyKey.
 *   6. Therefore the system memory-cache key changes.
 *   7. Company and actor layers follow the same chain.
 *
 * Result:
 *
 *   Descendants do not need explicit recursive invalidation.
 *
 * Important:
 *
 *   Because this file has no TTL and no pruning, old dependency-chain entries
 *   can remain in memory until the process restarts or until they are directly
 *   invalidated by tag.
 */

/**
 * =============================================================================
 * CACHE TAGS
 * =============================================================================
 *
 * These are not Next.js cache tags.
 *
 * They are local in-memory tags that intentionally follow the same naming
 * strategy as the regular cache file, so the public invalidation API behaves
 * the same way.
 */

const TAG_PREFIX = "core-cache";

const TENANT_GLOBAL_SETTING_TAG = `${TAG_PREFIX}:tenant-global-setting`;
const SYSTEM_SETTING_TAG = `${TAG_PREFIX}:system-setting`;
const COMPANY_SETTING_TAG = `${TAG_PREFIX}:company-setting`;
const ACTOR_SETTING_TAG = `${TAG_PREFIX}:actor-setting`;

/**
 * =============================================================================
 * MEMORY STORE
 * =============================================================================
 *
 * entries:
 *
 *   cacheKey -> MemoryCacheEntry
 *
 * tagIndex:
 *
 *   tag -> set of cache keys
 *
 *   This allows updateTenantCache() and revalidateTenantCache() to find every
 *   memory entry associated with a tenant/key scope.
 *
 * keyVersions:
 *
 *   cacheKey -> numeric version
 *
 *   This prevents an old in-flight source read from writing back into memory
 *   after the entry was invalidated.
 *
 * Race example:
 *
 *   1. get() starts loading key A.
 *   2. updateTenantCache() invalidates key A before the load finishes.
 *   3. The old load finishes.
 *
 * Without keyVersions:
 *
 *   The old load could restore stale data into memory.
 *
 * With keyVersions:
 *
 *   The old load sees that the key version changed and skips the memory write.
 */

type MemoryCacheEntry<T> = {
  /**
   * Local memory tags attached to this cache entry.
   */
  tags: readonly string[];

  /**
   * Whether this entry currently has a usable value.
   *
   * We do not use value !== undefined because a generic cache should support
   * undefined values safely.
   */
  hasValue: boolean;

  /**
   * Cached value.
   *
   * Values are cloned on write and cloned again on read so callers cannot mutate
   * the stored memory value accidentally.
   */
  value?: T;

  /**
   * Marks whether this value should be refreshed on the next read.
   *
   * There is no TTL here.
   *
   * stale = false:
   *   return value directly.
   *
   * stale = true:
   *   return the current value immediately, but start a background refresh.
   *
   * If no value exists, reads block until the source is loaded.
   */
  stale: boolean;

  /**
   * In-flight source read.
   *
   * This deduplicates concurrent requests for the same cache key.
   */
  pending?: Promise<T>;

  /**
   * Version captured when the entry was last loaded.
   */
  version: number;
};

type MemoryCacheStore = {
  entries: Map<string, MemoryCacheEntry<unknown>>;
  tagIndex: Map<string, Set<string>>;
  keyVersions: Map<string, number>;
};

/**
 * Keep the memory store on globalThis.
 *
 * This avoids losing the cache when the module is reloaded in development and
 * makes all imports inside the same process share the same cache.
 *
 * This does not make the cache distributed.
 */
const globalState = globalThis as typeof globalThis & {
  __coreInstrumentationTenantCacheV1?: MemoryCacheStore;
};

const MEMORY: MemoryCacheStore =
  globalState.__coreInstrumentationTenantCacheV1 ??
    {
      entries: new Map<string, MemoryCacheEntry<unknown>>(),
      tagIndex: new Map<string, Set<string>>(),
      keyVersions: new Map<string, number>(),
    };

globalState.__coreInstrumentationTenantCacheV1 = MEMORY;

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
 *   undefined / {}                            -> global tenant scope
 *   { systemId }                              -> system scope
 *   { systemId, companyId }                   -> company scope
 *   { systemId, companyId, actorId }          -> actor scope
 *
 * merge:
 *
 *   Optional LayerMerger for custom composition across hierarchy levels.
 *
 *   When omitted, the default behavior is:
 *
 *     - object + object => deep merge
 *     - primitive/array child => child overrides parent
 *     - missing child => parent remains unchanged
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

/**
 * Immediately invalidates matching entries in memory.
 *
 * This is the blocking invalidation path.
 *
 * It deletes matching entries from the current process memory cache. The next
 * read must reload the affected layer from the source.
 *
 * This mirrors the intent of:
 *
 *   revalidateTag(tag, { expire: 0 })
 *
 * from the Next.js cache version.
 *
 * Important:
 *
 *   Only the selected layer is invalidated directly.
 *
 *   Descendants are not recursively deleted. Instead, once the invalidated layer
 *   reloads and produces a new dependencyKey, descendants naturally move to new
 *   memory-cache keys.
 */
export function updateTenantCache(
  tenant?: Tenant,
  key?: string,
): void {
  const normalized = normalizeTenant(tenant);
  invalidateMemoryTag(tenantInvalidationTag(normalized, key), "blocking");
}

/**
 * =============================================================================
 * PUBLIC REVALIDATION API
 * =============================================================================
 */

/**
 * Revalidates matching entries in memory.
 *
 * mode = "blocking":
 *
 *   Deletes matching entries immediately.
 *   The next read blocks and reloads from the source.
 *
 * mode = "lazy":
 *
 *   Keeps the current value but marks it stale.
 *   The next read returns the current value immediately and starts a background
 *   refresh.
 *
 * Since this memory cache has no TTL, lazy revalidation only happens when this
 * function marks an entry stale.
 */
export function revalidateTenantCache(
  tenant?: Tenant,
  key?: string,
  mode: RevalidationMode = "lazy",
): void {
  const normalized = normalizeTenant(tenant);
  invalidateMemoryTag(tenantInvalidationTag(normalized, key), mode);
}

/**
 * =============================================================================
 * PRIVATE COMPOSITION ENGINE
 * =============================================================================
 */
// ── Data Source Functions ────────────────────────────────────────────────────

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

/**
 * Resolves a setting through the tenant hierarchy.
 *
 * This function performs only orchestration and composition.
 *
 * Each cachedXSetting() function loads one raw layer. The merger decides how
 * parent and child layers combine.
 */
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
 * PRIVATE MEMORY-CACHED LAYER READERS
 * =============================================================================
 *
 * Each function returns RawLayer:
 *
 *   own layer data + computed dependencyKey
 *
 * There is intentionally no composition inside these functions.
 */

async function cachedTenantGlobalSetting(
  key: string,
): Promise<RawLayer> {
  return memoryCachedRawLayer(
    rawLayerCacheKey("tenant-global", { key }),
    [
      TENANT_GLOBAL_SETTING_TAG,
      tenantGlobalTag(),
      tenantGlobalKeyTag(key),
    ],
    async () => {
      const own = await readGlobalFromSource(key);

      const dependencyKey = await dependencyHash({
        type: "root",
        level: "tenant-global",
        key,
        ownToken: ownToken(own),
      });

      return serializeRawLayer({ ...own, dependencyKey });
    },
  );
}

async function cachedSystemSetting(
  systemId: string,
  key: string,
  parentDependencyKey: string,
): Promise<RawLayer> {
  return memoryCachedRawLayer(
    rawLayerCacheKey("system", {
      systemId,
      key,
      parentDependencyKey,
    }),
    [
      SYSTEM_SETTING_TAG,
      systemTag(systemId),
      systemKeyTag(systemId, key),
    ],
    async () => {
      const own = await readSystemFromSource(systemId, key);

      const dependencyKey = await dependencyHash({
        type: "child",
        level: "system",
        key,
        parentDependencyKey,
        ownToken: ownToken(own),
      });

      return serializeRawLayer({ ...own, dependencyKey });
    },
  );
}

async function cachedCompanySetting(
  systemId: string,
  companyId: string,
  key: string,
  parentDependencyKey: string,
): Promise<RawLayer> {
  return memoryCachedRawLayer(
    rawLayerCacheKey("company", {
      systemId,
      companyId,
      key,
      parentDependencyKey,
    }),
    [
      COMPANY_SETTING_TAG,
      companyTag(systemId, companyId),
      companyKeyTag(systemId, companyId, key),
    ],
    async () => {
      const own = await readCompanyFromSource(systemId, companyId, key);

      const dependencyKey = await dependencyHash({
        type: "child",
        level: "company",
        key,
        parentDependencyKey,
        ownToken: ownToken(own),
      });

      return serializeRawLayer({ ...own, dependencyKey });
    },
  );
}

async function cachedActorSetting(
  systemId: string,
  companyId: string,
  actorId: string,
  key: string,
  parentDependencyKey: string,
): Promise<RawLayer> {
  return memoryCachedRawLayer(
    rawLayerCacheKey("actor", {
      systemId,
      companyId,
      actorId,
      key,
      parentDependencyKey,
    }),
    [
      ACTOR_SETTING_TAG,
      actorTag(systemId, companyId, actorId),
      actorKeyTag(systemId, companyId, actorId, key),
    ],
    async () => {
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

      return serializeRawLayer({ ...own, dependencyKey });
    },
  );
}

/**
 * =============================================================================
 * MEMORY CACHE CORE
 * =============================================================================
 */

/**
 * Reads a RawLayer through the local memory cache.
 */
async function memoryCachedRawLayer(
  cacheKey: string,
  tags: readonly string[],
  load: () => Promise<RawLayer>,
): Promise<RawLayer> {
  return memoryCached(cacheKey, tags, load);
}

/**
 * Generic memory-cache reader.
 *
 * Behavior:
 *
 *   1. Fresh existing value:
 *        return cloned value.
 *
 *   2. Existing value marked stale:
 *        return cloned value immediately and start background refresh.
 *
 *   3. Existing pending load:
 *        wait for the pending load.
 *
 *   4. Missing entry:
 *        load from source and store result.
 *
 * There is no TTL.
 * There is no automatic expiration.
 * There is no automatic pruning.
 */
async function memoryCached<T>(
  cacheKey: string,
  tags: readonly string[],
  load: () => Promise<T>,
): Promise<T> {
  const existing = MEMORY.entries.get(cacheKey) as
    | MemoryCacheEntry<T>
    | undefined;

  if (existing?.hasValue && !existing.stale) {
    return existing.value as T;
  }

  if (existing?.hasValue && existing.stale) {
    if (!existing.pending) {
      const pending = startMemoryLoad(cacheKey, tags, load, existing);
      void pending.catch(() => undefined);
    }

    return existing.value as T;
  }

  if (existing?.pending) {
    return await existing.pending;
  }

  return await startMemoryLoad(cacheKey, tags, load, existing);
}

/**
 * Starts a source load for one cache key.
 *
 * Concurrent reads share the same pending Promise.
 *
 * The load version protects against stale writes after invalidation.
 */
function startMemoryLoad<T>(
  cacheKey: string,
  tags: readonly string[],
  load: () => Promise<T>,
  existing?: MemoryCacheEntry<T>,
): Promise<T> {
  const loadVersion = currentMemoryKeyVersion(cacheKey);

  const pending = load()
    .then((loadedValue) => {
      const value = loadedValue;

      /**
       * If the key was invalidated while this source read was in flight, do not
       * write the loaded value back into memory.
       */
      if (currentMemoryKeyVersion(cacheKey) === loadVersion) {
        putMemoryValue(cacheKey, tags, value, loadVersion);
      }

      return value;
    })
    .catch((error) => {
      const current = MEMORY.entries.get(cacheKey) as
        | MemoryCacheEntry<T>
        | undefined;

      /**
       * If this pending promise is still attached to the entry, detach it.
       *
       * If the entry had an old value, keep that value.
       * If the entry had no value, remove the entry entirely.
       */
      if (current?.pending === pending) {
        if (current.hasValue) {
          setMemoryEntry(cacheKey, {
            ...current,
            pending: undefined,
          });
        } else {
          deleteMemoryEntry(cacheKey);
        }
      }

      throw error;
    });

  setMemoryEntry(cacheKey, {
    tags,
    hasValue: existing?.hasValue ?? false,
    value: existing?.value,
    stale: existing?.stale ?? true,
    pending,
    version: loadVersion,
  });

  return pending;
}

/**
 * Stores a resolved value in memory.
 */
function putMemoryValue<T>(
  cacheKey: string,
  tags: readonly string[],
  value: T,
  version: number,
): void {
  setMemoryEntry(cacheKey, {
    tags,
    hasValue: true,
    value: value,
    stale: false,
    pending: undefined,
    version,
  });
}

/**
 * Sets a memory entry and updates the tag index.
 */
function setMemoryEntry<T>(
  cacheKey: string,
  entry: MemoryCacheEntry<T>,
): void {
  removeCacheKeyFromAllTags(cacheKey);
  MEMORY.entries.set(cacheKey, entry as MemoryCacheEntry<unknown>);

  for (const tagValue of entry.tags) {
    let keys = MEMORY.tagIndex.get(tagValue);

    if (!keys) {
      keys = new Set<string>();
      MEMORY.tagIndex.set(tagValue, keys);
    }

    keys.add(cacheKey);
  }
}

/**
 * Deletes one memory entry and removes it from every indexed tag.
 */
function deleteMemoryEntry(cacheKey: string): void {
  MEMORY.entries.delete(cacheKey);
  removeCacheKeyFromAllTags(cacheKey);
}

/**
 * Removes a cache key from all tag sets.
 */
function removeCacheKeyFromAllTags(cacheKey: string): void {
  for (const [tagValue, keys] of MEMORY.tagIndex.entries()) {
    keys.delete(cacheKey);

    if (keys.size === 0) {
      MEMORY.tagIndex.delete(tagValue);
    }
  }
}

/**
 * Invalidates all memory entries associated with a local tag.
 *
 * blocking:
 *
 *   Delete entries immediately.
 *
 * lazy:
 *
 *   Keep existing values, mark them stale, and refresh on next read.
 */
function invalidateMemoryTag(tagValue: string, mode: RevalidationMode): void {
  const keys = [...(MEMORY.tagIndex.get(tagValue) ?? [])];

  for (const cacheKey of keys) {
    if (mode === "blocking") {
      bumpMemoryKeyVersion(cacheKey);
      deleteMemoryEntry(cacheKey);
      continue;
    }

    markMemoryEntryStale(cacheKey);
  }
}

/**
 * Marks one entry stale.
 *
 * If the entry has a value, the next read returns that value immediately and
 * starts a background refresh.
 *
 * If the entry has no value, there is nothing useful to serve lazily, so the
 * entry is removed.
 */
function markMemoryEntryStale(cacheKey: string): void {
  const existing = MEMORY.entries.get(cacheKey);

  bumpMemoryKeyVersion(cacheKey);

  if (!existing?.hasValue) {
    deleteMemoryEntry(cacheKey);
    return;
  }

  setMemoryEntry(cacheKey, {
    ...existing,
    stale: true,
    pending: undefined,
    version: currentMemoryKeyVersion(cacheKey),
  });
}

/**
 * Returns the current invalidation version for a cache key.
 */
function currentMemoryKeyVersion(cacheKey: string): number {
  return MEMORY.keyVersions.get(cacheKey) ?? 0;
}

/**
 * Bumps the invalidation version for a cache key.
 *
 * Any in-flight load that started before this bump will be allowed to return to
 * its own caller, but it will not be allowed to write into the memory cache.
 */
function bumpMemoryKeyVersion(cacheKey: string): void {
  MEMORY.keyVersions.set(cacheKey, currentMemoryKeyVersion(cacheKey) + 1);
}

/**
 * Creates a stable string key for a raw layer.
 */
function rawLayerCacheKey(
  level: "tenant-global" | "system" | "company" | "actor",
  input: Record<string, string>,
): string {
  return stableStringify({
    type: "raw-layer",
    level,
    input,
  });
}

/**
 * Serializes RawLayer the same way a remote/cache boundary would.
 *
 * This prevents callers from mutating source objects or cache objects by
 * reference.
 */
function serializeRawLayer(layer: RawLayer): RawLayer {
  return layer;
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
  if (!normalized) {
    throw new Error("Invalid setting key: key cannot be empty.");
  }
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
