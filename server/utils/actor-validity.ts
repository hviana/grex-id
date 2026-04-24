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
 * The cache is sharded by tenant key `<companyId>:<systemId>` and
 * registered dynamically on first access for that tenant. Loading,
 * eviction, and consistency therefore operate per tenant — a mutation in
 * one tenant never touches another.
 *
 * The universal actor id is `user.id` for user sessions and `api_token.id`
 * for API tokens and connected-app tokens. Every bearer is a JWT whose
 * `actorId` claim is this id; verification by `withAuth` is uniform across
 * actor types (§8.11 rules, §8.1).
 */

const SLUG = "actor-validity";

/** Tenant keys already registered in the cache registry (§12.11). */
const registeredTenants: Set<string> = new Set();

function tenantKey(tenant: { companyId: string; systemId: string }): string {
  return `${tenant.companyId}:${tenant.systemId}`;
}

async function loadTenantPartition(
  companyId: string,
  systemId: string,
): Promise<Set<string>> {
  // Anonymous tenant (0:0) has no persisted actors — only live user
  // sessions, which are added through login/register. Skip the DB probe.
  if (companyId === "0" || systemId === "0") {
    return new Set<string>();
  }

  const rows = await fetchActiveApiTokenIds({ companyId, systemId });

  const set = new Set<string>();
  for (const row of rows) {
    set.add(String(row.id));
  }
  return set;
}

function ensureRegistered(
  tenant: { companyId: string; systemId: string },
): string {
  const key = tenantKey(tenant);
  if (!registeredTenants.has(key)) {
    registerCache<Set<string>>(
      SLUG,
      key,
      () => loadTenantPartition(tenant.companyId, tenant.systemId),
    );
    registeredTenants.add(key);
  }
  return key;
}

/**
 * Hydrates the tenant's partition on first access. `withAuth` awaits this
 * once per request before the synchronous `isActorValid` check.
 */
export async function ensureActorValidityLoaded(
  tenant: { companyId: string; systemId: string },
): Promise<void> {
  const key = ensureRegistered(tenant);
  await getCache<Set<string>>(SLUG, key);
}

/**
 * Single verification function — the only read used by withAuth.
 *
 * Returns `true` iff the tenant's partition is loaded AND the `actorId`
 * appears in it. The caller guarantees the partition is loaded by calling
 * `ensureActorValidityLoaded` first; when `false` is returned because the
 * partition has not yet loaded, treat it as "not valid" — the next request
 * will succeed after the async load completes.
 */
export function isActorValid(
  tenant: { companyId: string; systemId: string },
  actorId: string,
): boolean {
  if (!actorId) return false;
  const key = tenantKey(tenant);
  const set = getCacheIfLoaded<Set<string>>(SLUG, key);
  if (!set) return false;
  return set.has(actorId);
}

/** Add an actor id to its tenant's partition. */
export async function rememberActor(
  tenant: { companyId: string; systemId: string },
  actorId: string,
): Promise<void> {
  if (!actorId) return;
  const key = ensureRegistered(tenant);
  const set = await getCache<Set<string>>(SLUG, key);
  set.add(actorId);
}

/** Remove an actor id from its tenant's partition. */
export async function forgetActor(
  tenant: { companyId: string; systemId: string },
  actorId: string,
): Promise<void> {
  if (!actorId) return;
  const key = ensureRegistered(tenant);
  const set = await getCache<Set<string>>(SLUG, key);
  set.delete(actorId);
}

/** Force-reload a single tenant's partition from the DB. */
export async function reloadTenant(
  tenant: { companyId: string; systemId: string },
): Promise<void> {
  const key = ensureRegistered(tenant);
  await updateCache<Set<string>>(SLUG, key);
}
