import { assertServerOnly } from "./server-only.ts";

assertServerOnly("file-cache.ts");

export interface FileCacheResult {
  hit: boolean;
  noCache: boolean;
  data?: Uint8Array;
  mimeType?: string;
}

export interface FileCacheStats {
  usedBytes: number;
  maxBytes: number;
  fileCount: number;
}

interface CachedFile {
  data: Uint8Array;
  size: number;
  mimeType: string;
  accesses: number[]; // Date.now() timestamps per hit
  lastAccess: number; // accessCounter value for LRU tiebreaking
}

interface TenantFileCache {
  files: Map<string, CachedFile>;
  usedSize: number;
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

  private pruneAccesses(
    file: CachedFile,
    now: number,
    hitWindowMs: number,
  ): number {
    const cutoff = now - hitWindowMs;
    while (file.accesses.length > 0 && file.accesses[0] < cutoff) {
      file.accesses.shift();
    }
    return file.accesses.length;
  }

  private score(file: CachedFile, now: number, hitWindowMs: number): number {
    const hits = this.pruneAccesses(file, now, hitWindowMs);
    return hits / file.size;
  }

  access(
    tenantKey: string,
    fileId: string,
    fileSize: number,
    maxSize: number,
    data?: Uint8Array,
    hitWindowMs: number = 3600000,
    mimeType: string = "application/octet-stream",
  ): FileCacheResult {
    this.accessCounter += 1;
    const now = Date.now();

    if (maxSize <= 0) {
      return { hit: false, noCache: true };
    }

    let tenant = this.tenants.get(tenantKey);
    if (!tenant) {
      tenant = { files: new Map(), usedSize: 0 };
      this.tenants.set(tenantKey, tenant);
    }

    const existing = tenant.files.get(fileId);
    if (existing) {
      existing.accesses.push(now);
      this.pruneAccesses(existing, now, hitWindowMs);
      existing.lastAccess = this.accessCounter;
      return {
        hit: true,
        noCache: false,
        data: existing.data,
        mimeType: existing.mimeType,
      };
    }

    if (fileSize > maxSize) {
      return { hit: false, noCache: true };
    }

    if (!data) {
      return { hit: false, noCache: false };
    }

    while (tenant.usedSize + fileSize > maxSize && tenant.files.size > 0) {
      const victim = this.findVictim(tenant, now, hitWindowMs);
      if (!victim) break;
      tenant.files.delete(victim.key);
      tenant.usedSize -= victim.size;
    }

    tenant.files.set(fileId, {
      data,
      size: fileSize,
      mimeType,
      accesses: [now],
      lastAccess: this.accessCounter,
    });
    tenant.usedSize += fileSize;

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

  evict(tenantKey: string, fileId: string): void {
    const tenant = this.tenants.get(tenantKey);
    if (!tenant) return;
    const removed = tenant.files.get(fileId);
    if (removed) {
      tenant.usedSize -= removed.size;
      tenant.files.delete(fileId);
    }
  }

  clearTenant(tenantKey: string): void {
    this.tenants.delete(tenantKey);
  }

  clearAll(): void {
    this.tenants.clear();
  }

  private findVictim(
    tenant: TenantFileCache,
    now: number,
    hitWindowMs: number,
  ): { key: string; size: number } | null {
    let worst:
      | { key: string; score: number; lastAccess: number; size: number }
      | null = null;

    for (const [key, file] of tenant.files) {
      const s = this.score(file, now, hitWindowMs);
      if (
        !worst ||
        s < worst.score ||
        (s === worst.score && file.lastAccess < worst.lastAccess)
      ) {
        worst = { key, score: s, lastAccess: file.lastAccess, size: file.size };
      }
    }

    return worst ? { key: worst.key, size: worst.size } : null;
  }
}

export default FileCacheManager;
