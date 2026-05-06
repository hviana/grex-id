import "server-only";

/**
 * Returns (lazily initialising) a namespaced singleton backed by `globalThis`.
 *
 * Turbopack may create separate module instances when the same file is imported
 * from different contexts (e.g. `server/` via relative paths at boot time vs
 * `app/api/` via the `@/` alias at request time).  Storing mutable registries
 * on `globalThis` guarantees that `register*` (called at boot from
 * instrumentation) and every accessor (called from route handlers) operate on
 * the **same** state — no silent splits, no empty-registry surprises.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-constraint
export function getState<T extends object>(
  key: string,
  initial: T,
): T {
  const g = globalThis as typeof globalThis & Record<string, T | undefined>;
  if (!g[key]) {
    g[key] = initial;
  }
  return g[key]!;
}
