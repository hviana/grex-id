if (typeof window !== "undefined") {
  throw new Error("file-cache.ts must not be imported in client-side code.");
}

export interface FileCacheResult {
  hit: boolean;
  noCache: boolean;
  data?: Uint8Array;
}

export interface FileCacheStats {
  usedBytes: number;
  maxBytes: number;
  fileCount: number;
}

interface CachedFile {
  data: Uint8Array;
  size: number;
  hits: number;
  lastAccess: number;
}

interface TenantFileCache {
  files: Map<string, CachedFile>;
  usedSize: number;
  churnSize: number;
}

class FileCacheManager {
  private tenants: Map<string, TenantFileCache> = new Map();
  private accessCounter: number = 0;
  private static instance: FileCacheManager | null = null;

  private constructor() {}

  static getInstance(): FileCacheManager {
    if (!FileCacheManager.instance) {
      FileCacheManager.instance = new FileCacheManager();
    }
    return FileCacheManager.instance;
  }

  access(
    tenantKey: string,
    fileId: string,
    fileSize: number,
    maxSize: number,
    data?: Uint8Array,
  ): FileCacheResult {
    this.accessCounter += 1;

    if (maxSize <= 0) {
      return { hit: false, noCache: true };
    }

    let tenant = this.tenants.get(tenantKey);
    if (!tenant) {
      tenant = { files: new Map(), usedSize: 0, churnSize: 0 };
      this.tenants.set(tenantKey, tenant);
    }

    const existing = tenant.files.get(fileId);
    if (existing) {
      existing.hits += 1;
      existing.lastAccess = this.accessCounter;
      return { hit: true, noCache: false, data: existing.data };
    }

    if (fileSize > maxSize) {
      return { hit: false, noCache: true };
    }

    if (!data) {
      return { hit: false, noCache: false };
    }

    while (tenant.usedSize + fileSize > maxSize && tenant.files.size > 0) {
      const victim = this.findVictim(tenant);
      if (!victim) break;
      tenant.files.delete(victim.key);
      tenant.usedSize -= victim.size;
    }

    tenant.files.set(fileId, {
      data,
      size: fileSize,
      hits: 1,
      lastAccess: this.accessCounter,
    });
    tenant.usedSize += fileSize;
    tenant.churnSize += fileSize;

    while (tenant.churnSize >= maxSize) {
      const toDelete: string[] = [];
      for (const [key, file] of tenant.files) {
        file.hits = Math.floor(file.hits / 2);
        if (file.hits === 0) {
          toDelete.push(key);
        }
      }
      for (const key of toDelete) {
        const removed = tenant.files.get(key);
        if (removed) {
          tenant.usedSize -= removed.size;
          tenant.files.delete(key);
        }
      }
      tenant.churnSize -= maxSize;
    }

    return { hit: false, noCache: false };
  }

  getStats(tenantKey: string, maxSize: number): FileCacheStats {
    const tenant = this.tenants.get(tenantKey);
    if (!tenant) {
      return { usedBytes: 0, maxBytes: maxSize, fileCount: 0 };
    }
    return {
      usedBytes: tenant.usedSize,
      maxBytes: maxSize,
      fileCount: tenant.files.size,
    };
  }

  shouldCache(tenantKey: string, fileSize: number, maxSize: number): boolean {
    if (maxSize <= 0 || fileSize > maxSize) return false;

    const tenant = this.tenants.get(tenantKey);
    if (!tenant || tenant.usedSize + fileSize <= maxSize) return true;

    const newScore = 1 / fileSize;
    for (const file of tenant.files.values()) {
      if (file.hits / file.size < newScore) return true;
    }
    return false;
  }

  clearTenant(tenantKey: string): void {
    this.tenants.delete(tenantKey);
  }

  clearAll(): void {
    this.tenants.clear();
  }

  private findVictim(
    tenant: TenantFileCache,
  ): { key: string; size: number } | null {
    let worst:
      | { key: string; score: number; lastAccess: number; size: number }
      | null = null;

    for (const [key, file] of tenant.files) {
      const score = file.hits / file.size;
      if (
        !worst ||
        score < worst.score ||
        (score === worst.score && file.lastAccess < worst.lastAccess)
      ) {
        worst = { key, score, lastAccess: file.lastAccess, size: file.size };
      }
    }

    return worst ? { key: worst.key, size: worst.size } : null;
  }
}

export default FileCacheManager;
