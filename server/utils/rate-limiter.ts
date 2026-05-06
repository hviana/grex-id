import "server-only";

import type {
  RateLimitConfig,
  RateLimitResult,
} from "@/src/contracts/high-level/rate-limiter";

export type { RateLimitConfig, RateLimitResult };

interface SlidingWindowEntry {
  timestamps: number[];
}

const store = new Map<string, SlidingWindowEntry>();

const CLEANUP_INTERVAL_MS = 60_000;
let lastCleanup = Date.now();

function cleanup(windowMs: number): void {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;

  const cutoff = now - windowMs;
  for (const [key, entry] of store) {
    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
    if (entry.timestamps.length === 0) {
      store.delete(key);
    }
  }
}

// RateLimitConfig and RateLimitResult types are now in @/src/contracts/high-level/rate-limiter

export function checkRateLimit(
  key: string,
  config: RateLimitConfig,
): RateLimitResult {
  const now = Date.now();
  const cutoff = now - config.windowMs;

  cleanup(config.windowMs);

  let entry = store.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(key, entry);
  }

  entry.timestamps = entry.timestamps.filter((t) => t > cutoff);

  if (entry.timestamps.length >= config.maxRequests) {
    const oldestInWindow = entry.timestamps[0];
    return {
      allowed: false,
      remaining: 0,
      resetMs: oldestInWindow + config.windowMs - now,
    };
  }

  entry.timestamps.push(now);

  return {
    allowed: true,
    remaining: config.maxRequests - entry.timestamps.length,
    resetMs: config.windowMs,
  };
}

export function resetRateLimit(key: string): void {
  store.delete(key);
}
