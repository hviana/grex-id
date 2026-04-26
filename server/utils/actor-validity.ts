import {
  getCache,
  getCacheIfLoaded,
  registerCache,
  updateCache,
} from "./cache.ts";
import { assertServerOnly } from "./server-only.ts";
import { fetchActiveApiTokenIds } from "../db/queries/actor-validity.ts";

assertServerOnly("actor-validity.ts");

/**
 * Actor-validity cache (§8.11).
 *
 * Per-tenant `Set<actorId>` holding the ids of every actor that is
 * currently allowed to authenticate against the tenant. An actor id is
 * valid iff it appears in its tenant's set; absence IS revocation.
 *
 * The cache is sharded by `tenantId` (the tenant record ID) and
 * registered dynamically on first access for that tenant.
 */

const SLUG = "actor-validity";

const registeredTenants: Set<string> = new Set();

async function loadTenantPartition(tenantId: string): Promise<Set<string>> {
  const rows = await fetchActiveApiTokenIds({ tenantId });

  const set = new Set<string>();
  for (const row of rows) {
    set.add(String(row.id));
  }
  return set;
}

function ensureRegistered(tenantId: string): string {
  if (!registeredTenants.has(tenantId)) {
    registerCache<Set<string>>(
      SLUG,
      tenantId,
      () => loadTenantPartition(tenantId),
    );
    registeredTenants.add(tenantId);
  }
  return tenantId;
}

/**
 * Hydrates the tenant's partition on first access. `withAuth` awaits this
 * once per request before the synchronous `isActorValid` check.
 */
export async function ensureActorValidityLoaded(
  tenantId: string,
): Promise<void> {
  const key = ensureRegistered(tenantId);
  await getCache<Set<string>>(SLUG, key);
}

/**
 * Single verification function — the only read used by withAuth.
 */
export function isActorValid(tenantId: string, actorId: string): boolean {
  if (!actorId) return false;
  const set = getCacheIfLoaded<Set<string>>(SLUG, tenantId);
  if (!set) return false;
  return set.has(actorId);
}

/** Add an actor id to its tenant's partition. */
export async function rememberActor(
  tenantId: string,
  actorId: string,
): Promise<void> {
  if (!actorId) return;
  const key = ensureRegistered(tenantId);
  const set = await getCache<Set<string>>(SLUG, key);
  set.add(actorId);
}

/** Remove an actor id from its tenant's partition. */
export async function forgetActor(
  tenantId: string,
  actorId: string,
): Promise<void> {
  if (!actorId) return;
  const key = ensureRegistered(tenantId);
  const set = await getCache<Set<string>>(SLUG, key);
  set.delete(actorId);
}

/** Force-reload a single tenant's partition from the DB. */
export async function reloadTenant(tenantId: string): Promise<void> {
  const key = ensureRegistered(tenantId);
  await updateCache<Set<string>>(SLUG, key);
}
