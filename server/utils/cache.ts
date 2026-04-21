import { assertServerOnly } from "./server-only.ts";

assertServerOnly("cache.ts");

let booted = false;
let bootPromise: Promise<void> | null = null;

async function ensureBooted(): Promise<void> {
  if (booted) return;
  if (!bootPromise) {
    bootPromise = (async () => {
      const { registerCore } = await import("../core-register.ts");
      registerCore();
      try {
        const mod = await import("../../systems/index.ts");
        mod.registerAllSystems();
      } catch { /* systems may not exist yet */ }
      try {
        const mod = await import("../../frameworks/index.ts");
        mod.registerAllFrameworks();
      } catch { /* frameworks may not exist yet */ }
      booted = true;
    })();
  }
  await bootPromise;
}

type CacheLoader<T> = () => Promise<T>;

interface CacheEntry<T> {
  loader: CacheLoader<T>;
  value: T | undefined;
  loaded: boolean;
  loadPromise: Promise<void> | null;
}

const cacheRegistry: Map<string, CacheEntry<unknown>> = new Map();

function cacheKey(slug: string, name: string): string {
  return `${slug}::${name}`;
}

export function registerCache<T>(
  slug: string,
  name: string,
  loader: CacheLoader<T>,
): void {
  const key = cacheKey(slug, name);
  const existing = cacheRegistry.get(key);
  if (existing) {
    existing.loader = loader as CacheLoader<unknown>;
    return;
  }
  cacheRegistry.set(key, {
    loader: loader as CacheLoader<unknown>,
    value: undefined,
    loaded: false,
    loadPromise: null,
  });
}

export async function getCache<T>(slug: string, name: string): Promise<T> {
  const key = cacheKey(slug, name);
  let entry = cacheRegistry.get(key) as CacheEntry<T> | undefined;

  if (!entry) {
    await ensureBooted();
    entry = cacheRegistry.get(key) as CacheEntry<T> | undefined;
    if (!entry) {
      throw new Error(
        `[Cache] "${name}" not registered for slug "${slug}". Call registerCache first.`,
      );
    }
  }

  if (entry.loaded) {
    return entry.value as T;
  }

  if (!entry.loadPromise) {
    entry.loadPromise = entry.loader()
      .then((result) => {
        entry!.value = result;
        entry!.loaded = true;
        entry!.loadPromise = null;
      })
      .catch((err) => {
        entry!.loadPromise = null;
        throw err;
      });
  }

  await entry.loadPromise;
  return entry.value as T;
}

export async function updateCache<T>(
  slug: string,
  name: string,
): Promise<T> {
  const key = cacheKey(slug, name);
  const entry = cacheRegistry.get(key) as CacheEntry<T> | undefined;

  if (!entry) {
    throw new Error(
      `[Cache] "${name}" not registered for slug "${slug}". Call registerCache first.`,
    );
  }

  const result = await entry.loader();
  entry.value = result;
  entry.loaded = true;
  return result;
}

export function clearCache(slug: string, name: string): void {
  const key = cacheKey(slug, name);
  const entry = cacheRegistry.get(key);
  if (entry) {
    entry.value = undefined;
    entry.loaded = false;
    entry.loadPromise = null;
  }
}

export function getCacheIfLoaded<T>(
  slug: string,
  name: string,
): T | undefined {
  const key = cacheKey(slug, name);
  const entry = cacheRegistry.get(key) as CacheEntry<T> | undefined;
  if (entry && entry.loaded) {
    return entry.value as T;
  }
  return undefined;
}

export function clearAllCacheForSlug(slug: string): void {
  const prefix = `${slug}::`;
  for (const [key, entry] of cacheRegistry) {
    if (key.startsWith(prefix)) {
      entry.value = undefined;
      entry.loaded = false;
      entry.loadPromise = null;
    }
  }
}
