import "server-only";

import type { MissingSetting } from "@/src/contracts/high-level/cache-data";

const missingCoreSettings = new Map<string, MissingSetting>();
const missingFrontSettings = new Map<string, MissingSetting>();

export function trackMissingCoreSetting(key: string): void {
  if (!missingCoreSettings.has(key)) {
    missingCoreSettings.set(key, {
      key,
      firstRequestedAt: new Date().toISOString(),
    });
  }
}

export function getMissingCoreSettings(): MissingSetting[] {
  return Array.from(missingCoreSettings.values());
}

export function clearMissingCoreSettings(): void {
  missingCoreSettings.clear();
}

export function trackMissingFrontSetting(key: string): void {
  if (!missingFrontSettings.has(key)) {
    missingFrontSettings.set(key, {
      key,
      firstRequestedAt: new Date().toISOString(),
    });
  }
}

export function getMissingFrontSettings(): MissingSetting[] {
  return Array.from(missingFrontSettings.values());
}

export function clearMissingFrontSettings(): void {
  missingFrontSettings.clear();
}
