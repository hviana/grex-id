/**
 * resolve-limits.ts — Three-layer resource limit resolution
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  OVERVIEW                                                              │
 * │                                                                        │
 * │  resolveLimits({ plan?, voucher?, actor? }) → ResolvedResourceLimit    │
 * │                                                                        │
 * │  Three optional ResourceLimit inputs produce one effective result.     │
 * │  All fields use the exact same names as the ResourceLimit contract     │
 * │  (minus `id`). Fields absent from every source are absent in output.   │
 * │                                                                        │
 * │  PRIMITIVE SEMANTICS                                                   │
 * │    • undefined / null / not present → unlimited (no limit set).        │
 * │    • 0 → disabled (feature explicitly turned off).                     │
 * │    • positive number → concrete limit.                                 │
 * │                                                                        │
 * │  HIERARCHY                                                             │
 * │    plan limits voucher, which limits actor.                            │
 * │    The hierarchy applies when determining what "undefined" means:      │
 * │    if plan is undefined (unlimited), voucher is also unlimited unless  │
 * │    the voucher explicitly specifies a value (becoming a limiter).      │
 * │    The actor is always capped by the merged plan+voucher result.       │
 * │                                                                        │
 * │  FIELD CLASSES                                                         │
 * │    1. NUMERIC  — apiRateLimit, storageLimitBytes, fileCacheLimitBytes, │
 * │       credits, maxConcurrentDownloads, maxConcurrentUploads,           │
 * │       maxDownloadBandwidthMB, maxUploadBandwidthMB.                    │
 * │    2. MAP      — entityLimits, maxOperationCountByResourceKey,         │
 * │       creditLimitByResourceKey (key→number records).                   │
 * │    3. ARRAY    — benefits, roleIds, frontendDomains (string arrays).   │
 * │    4. PRICE    — priceModifier (always numeric, always summed).        │
 * │                                                                        │
 * ├─────────────────────────────────────────────────────────────────────────┤
 * │  PHASE 1 — MERGE plan + voucher                                        │
 * │                                                                        │
 * │  For each field independently:                                         │
 * │                                                                        │
 * │  NUMERIC (mergeNum)                                                    │
 * │    plan=undefined, voucher=undefined → undefined (unlimited)           │
 * │    plan=defined,   voucher=undefined → plan value (voucher unchanged)  │
 * │    plan=undefined, voucher=defined   → voucher value                   │
 * │      (plan unlimited; voucher specifies a value and becomes limiter)   │
 * │    plan=defined,   voucher=defined   → max(0, plan + voucher)          │
 * │      (additive; voucher modifies plan; floor at 0)                     │
 * │                                                                        │
 * │    Edge cases:                                                         │
 * │      plan=100, voucher=undefined  → 100                                │
 * │      plan=undefined, voucher=100  → 100 (voucher is now the limiter)   │
 * │      plan=100, voucher=-30        → 70  (discount reduces limit)       │
 * │      plan=100, voucher=+50        → 150 (voucher grants more)          │
 * │      plan=100, voucher=-100       → 0   (disabled)                     │
 * │      plan=100, voucher=-200       → 0   (clamped to 0, disabled)       │
 * │      plan=0,    voucher=undefined → 0   (disabled at plan level)       │
 * │      plan=0,    voucher=50        → 50  (voucher overrides disable)    │
 * │      plan=0,    voucher=-10       → 0   (still disabled)               │
 * │      plan=undefined, voucher=0    → 0   (voucher explicitly disables)  │
 * │                                                                        │
 * │  MAP (mergeMap)                                                        │
 * │    Applied independently per key within the map.                       │
 * │    Keys present in only one source are passed through.                 │
 * │    Keys present in both are summed: max(0, plan[k] + voucher[k]).      │
 * │    If neither source provides the map or all keys resolve to empty,    │
 * │    the result is undefined.                                            │
 * │                                                                        │
 * │    Edge cases:                                                         │
 * │      plan={a:10}, voucher=undefined    → {a:10}                        │
 * │      plan=undefined, voucher={a:10}    → {a:10}                        │
 * │      plan={a:10}, voucher={a:5}        → {a:15}                        │
 * │      plan={a:10}, voucher={a:-5}       → {a:5}                         │
 * │      plan={a:10}, voucher={a:-10}      → {a:0} (disabled for key a)    │
 * │      plan={a:10}, voucher={b:20}       → {a:10, b:20}                  │
 * │      plan={a:10}, voucher={a:-10,b:5}  → {a:0, b:5}                   │
 * │      plan=undefined, voucher=undefined → undefined                     │
 * │      plan={},     voucher={}           → undefined (empty → omit)      │
 * │                                                                        │
 * │  ARRAY (mergeArr)                                                      │
 * │    Always concatenated (union): [...plan, ...voucher].                  │
 * │    Result is undefined if both sources are empty/undefined.            │
 * │                                                                        │
 * │  PRICE (priceModifier)                                                 │
 * │    Always summed: max(0, plan + voucher).                              │
 * │    Defaults to 0 when a source is absent.                              │
 * │    priceModifier is required (never undefined in output).              │
 * │                                                                        │
 * ├─────────────────────────────────────────────────────────────────────────┤
 * │  PHASE 2 — CLAMP actor against merged plan+voucher                     │
 * │                                                                        │
 * │  If no actor is provided, Phase 1 result is the final output.          │
 * │  Otherwise the actor's ResourceLimit is clamped by the merged result.  │
 * │  Actor undefined on a field = no cap from actor side.                  │
 * │  Merged undefined on a field = no tenant-level limit.                  │
 * │                                                                        │
 * │  NUMERIC (clampNum)                                                    │
 * │    actor=undefined, cap=undefined → undefined (unlimited)              │
 * │    actor=undefined, cap=defined   → cap (no actor cap; tenant limits)  │
 * │    actor=defined,   cap=undefined → actor (no tenant limit; actor cap) │
 * │    actor=defined,   cap=defined   → min(actor, cap)                    │
 * │                                                                        │
 * │    Edge cases:                                                         │
 * │      actor=50,  cap=100 → 50  (actor is more restrictive)              │
 * │      actor=100, cap=50  → 50  (tenant cap is more restrictive)         │
 * │      actor=50,  cap=50  → 50  (equal)                                  │
 * │      actor=0,   cap=100 → 0   (actor disabled, overrides everything)   │
 * │      actor=100, cap=0   → 0   (tenant disabled, actor can't override)  │
 * │      actor=0,   cap=0   → 0   (both disabled)                          │
 * │      actor=0,   cap=undefined → 0 (actor disabled, no tenant limit)     │
 * │      actor=undefined, cap=0 → 0 (tenant disabled, no actor cap)         │
 * │                                                                        │
 * │  MAP (clampMap)                                                        │
 * │    Applied independently per key.                                      │
 * │    Keys present in only one source are passed through.                 │
 * │    Keys present in both: min(actor[k], cap[k]).                        │
 * │    If both maps are empty/undefined, result is undefined.              │
 * │                                                                        │
 * │    Edge cases:                                                         │
 * │      actor={a:50},  cap={a:100} → {a:50}                               │
 * │      actor={a:100}, cap={a:50}  → {a:50}                               │
 * │      actor={a:50},  cap=undefined → {a:50}                             │
 * │      actor=undefined, cap={a:50} → {a:50}                              │
 * │      actor={a:50},  cap={b:30}  → {a:50, b:30}                         │
 * │      actor={a:0},   cap={a:100} → {a:0}  (actor disables key a)        │
 * │      actor={a:100}, cap={a:0}   → {a:0}  (tenant disables key a)       │
 * │                                                                        │
 * │  ARRAY (mergeArr — same as Phase 1)                                    │
 * │    Always concatenated: [...actor, ...cap].                            │
 * │    roleIds, benefits, and frontendDomains are always incremental.       │
 * │                                                                        │
 * │  PRICE (priceModifier)                                                 │
 * │    Always summed: max(0, actor + cap).                                 │
 * │    Never clamped — modifiers are additive across all layers.           │
 * │                                                                        │
 * ├─────────────────────────────────────────────────────────────────────────┤
 * │  FINAL OUTPUT                                                          │
 * │                                                                        │
 * │  ResolvedResourceLimit — all ResourceLimit fields minus `id`.          │
 * │  priceModifier is always present (required number).                    │
 * │  All other fields are optional; absent = unlimited.                    │
 * │  0 = disabled.                                                         │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import "server-only";

import type { ResourceLimit } from "@/src/contracts/resource-limit";

type RL = ResourceLimit | undefined;

const numVal = (rl: RL, key: string): number | undefined => {
  const v = (rl as unknown as Record<string, unknown>)?.[key];
  return v != null ? Number(v) : undefined;
};

const recVal = (
  rl: RL,
  key: string,
): Record<string, number> | undefined => {
  const v = (rl as unknown as Record<string, unknown>)?.[key];
  return typeof v === "object" && v !== null
    ? (v as Record<string, number>)
    : undefined;
};

const arrVal = (rl: RL, key: string): string[] | undefined => {
  const v = (rl as unknown as Record<string, unknown>)?.[key];
  if (!v) return undefined;
  if (Array.isArray(v)) return v.length > 0 ? v.map(String) : undefined;
  if (v instanceof Set) {
    const a = [...v].map(String);
    return a.length > 0 ? a : undefined;
  }
  return undefined;
};

// ── Merge helpers (plan + voucher) ──────────────────────────────────────────

function mergeNum(
  plan: number | undefined,
  voucher: number | undefined,
): number | undefined {
  if (plan == null && voucher == null) return undefined;
  if (voucher == null) return plan;
  if (plan == null) return voucher;
  return Math.max(0, plan + voucher);
}

function mergeMap(
  plan: Record<string, number> | undefined,
  voucher: Record<string, number> | undefined,
): Record<string, number> | undefined {
  if (!plan && !voucher) return undefined;
  const keys = new Set([
    ...Object.keys(plan ?? {}),
    ...Object.keys(voucher ?? {}),
  ]);
  const result: Record<string, number> = {};
  for (const k of keys) {
    const p = plan?.[k];
    const v = voucher?.[k];
    if (p == null && v == null) continue;
    if (v == null) {
      result[k] = p!;
      continue;
    }
    if (p == null) {
      result[k] = v;
      continue;
    }
    result[k] = Math.max(0, p + v);
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function mergeArr(
  a: string[] | undefined,
  b: string[] | undefined,
): string[] | undefined {
  const merged = [...(a ?? []), ...(b ?? [])];
  return merged.length > 0 ? merged : undefined;
}

// ── Clamp helpers (actor vs merged cap) ─────────────────────────────────────

function clampNum(
  actor: number | undefined,
  cap: number | undefined,
): number | undefined {
  if (actor == null && cap == null) return undefined;
  if (actor == null) return cap;
  if (cap == null) return actor;
  return Math.min(actor, cap);
}

function clampMap(
  actor: Record<string, number> | undefined,
  cap: Record<string, number> | undefined,
): Record<string, number> | undefined {
  if (!actor && !cap) return undefined;
  const keys = new Set([
    ...Object.keys(actor ?? {}),
    ...Object.keys(cap ?? {}),
  ]);
  const result: Record<string, number> = {};
  for (const k of keys) {
    const a = actor?.[k];
    const c = cap?.[k];
    if (a == null && c == null) continue;
    if (a == null) {
      result[k] = c!;
      continue;
    }
    if (c == null) {
      result[k] = a;
      continue;
    }
    result[k] = Math.min(a, c);
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

type ResolvedResourceLimit =
  & {
    [K in Exclude<keyof ResourceLimit, "id">]?: ResourceLimit[K];
  }
  & { priceModifier: number };

function mergePlanVoucher(plan: RL, voucher: RL): ResolvedResourceLimit {
  return {
    benefits: mergeArr(arrVal(plan, "benefits"), arrVal(voucher, "benefits")),
    roleIds: mergeArr(arrVal(plan, "roleIds"), arrVal(voucher, "roleIds")),
    entityLimits: mergeMap(
      recVal(plan, "entityLimits"),
      recVal(voucher, "entityLimits"),
    ),
    apiRateLimit: mergeNum(
      numVal(plan, "apiRateLimit"),
      numVal(voucher, "apiRateLimit"),
    ),
    priceModifier: Math.max(
      0,
      (numVal(plan, "priceModifier") ?? 0) +
        (numVal(voucher, "priceModifier") ?? 0),
    ),
    storageLimitBytes: mergeNum(
      numVal(plan, "storageLimitBytes"),
      numVal(voucher, "storageLimitBytes"),
    ),
    fileCacheLimitBytes: mergeNum(
      numVal(plan, "fileCacheLimitBytes"),
      numVal(voucher, "fileCacheLimitBytes"),
    ),
    credits: mergeNum(numVal(plan, "credits"), numVal(voucher, "credits")),
    maxConcurrentDownloads: mergeNum(
      numVal(plan, "maxConcurrentDownloads"),
      numVal(voucher, "maxConcurrentDownloads"),
    ),
    maxConcurrentUploads: mergeNum(
      numVal(plan, "maxConcurrentUploads"),
      numVal(voucher, "maxConcurrentUploads"),
    ),
    maxDownloadBandwidthMB: mergeNum(
      numVal(plan, "maxDownloadBandwidthMB"),
      numVal(voucher, "maxDownloadBandwidthMB"),
    ),
    maxUploadBandwidthMB: mergeNum(
      numVal(plan, "maxUploadBandwidthMB"),
      numVal(voucher, "maxUploadBandwidthMB"),
    ),
    maxOperationCountByResourceKey: mergeMap(
      recVal(plan, "maxOperationCountByResourceKey"),
      recVal(voucher, "maxOperationCountByResourceKey"),
    ),
    creditLimitByResourceKey: mergeMap(
      recVal(plan, "creditLimitByResourceKey"),
      recVal(voucher, "creditLimitByResourceKey"),
    ),
    frontendDomains: mergeArr(
      arrVal(plan, "frontendDomains"),
      arrVal(voucher, "frontendDomains"),
    ),
  };
}

function clampActor(
  actor: ResolvedResourceLimit,
  cap: ResolvedResourceLimit,
): ResolvedResourceLimit {
  return {
    benefits: mergeArr(actor.benefits, cap.benefits),
    roleIds: mergeArr(actor.roleIds, cap.roleIds),
    entityLimits: clampMap(actor.entityLimits, cap.entityLimits),
    apiRateLimit: clampNum(actor.apiRateLimit, cap.apiRateLimit),
    priceModifier: Math.max(
      0,
      actor.priceModifier + (cap.priceModifier ?? 0),
    ),
    storageLimitBytes: clampNum(actor.storageLimitBytes, cap.storageLimitBytes),
    fileCacheLimitBytes: clampNum(
      actor.fileCacheLimitBytes,
      cap.fileCacheLimitBytes,
    ),
    credits: clampNum(actor.credits, cap.credits),
    maxConcurrentDownloads: clampNum(
      actor.maxConcurrentDownloads,
      cap.maxConcurrentDownloads,
    ),
    maxConcurrentUploads: clampNum(
      actor.maxConcurrentUploads,
      cap.maxConcurrentUploads,
    ),
    maxDownloadBandwidthMB: clampNum(
      actor.maxDownloadBandwidthMB,
      cap.maxDownloadBandwidthMB,
    ),
    maxUploadBandwidthMB: clampNum(
      actor.maxUploadBandwidthMB,
      cap.maxUploadBandwidthMB,
    ),
    maxOperationCountByResourceKey: clampMap(
      actor.maxOperationCountByResourceKey,
      cap.maxOperationCountByResourceKey,
    ),
    creditLimitByResourceKey: clampMap(
      actor.creditLimitByResourceKey,
      cap.creditLimitByResourceKey,
    ),
    frontendDomains: mergeArr(actor.frontendDomains, cap.frontendDomains),
  };
}

export function resolveLimits(opts: {
  plan?: ResourceLimit;
  voucher?: ResourceLimit;
  actor?: ResourceLimit;
}): ResolvedResourceLimit {
  const merged = mergePlanVoucher(opts.plan, opts.voucher);

  if (!opts.actor) return merged;

  const actor: ResolvedResourceLimit = {
    roleIds: arrVal(opts.actor, "roleIds"),
    entityLimits: recVal(opts.actor, "entityLimits"),
    apiRateLimit: numVal(opts.actor, "apiRateLimit"),
    priceModifier: numVal(opts.actor, "priceModifier") ?? 0,
    storageLimitBytes: numVal(opts.actor, "storageLimitBytes"),
    fileCacheLimitBytes: numVal(opts.actor, "fileCacheLimitBytes"),
    credits: numVal(opts.actor, "credits"),
    maxConcurrentDownloads: numVal(opts.actor, "maxConcurrentDownloads"),
    maxConcurrentUploads: numVal(opts.actor, "maxConcurrentUploads"),
    maxDownloadBandwidthMB: numVal(opts.actor, "maxDownloadBandwidthMB"),
    maxUploadBandwidthMB: numVal(opts.actor, "maxUploadBandwidthMB"),
    maxOperationCountByResourceKey: recVal(
      opts.actor,
      "maxOperationCountByResourceKey",
    ),
    creditLimitByResourceKey: recVal(
      opts.actor,
      "creditLimitByResourceKey",
    ),
    frontendDomains: arrVal(opts.actor, "frontendDomains"),
  };

  return clampActor(actor, merged);
}
