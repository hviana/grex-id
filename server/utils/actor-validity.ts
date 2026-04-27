import {
  getCache,
  getCacheIfLoaded,
  registerCache,
  updateCache,
} from "./cache.ts";
import { assertServerOnly } from "./server-only.ts";
import type { Tenant } from "@/src/contracts/tenant";
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
  tenant: Tenant,
): Promise<void> {
  const key = ensureRegistered(tenant.id!);
  await getCache<Set<string>>(SLUG, key);
}

/**
 * Single verification function — the only read used by withAuth.
 */
export function isActorValid(tenant: Tenant): boolean {
  if (!tenant.actorId) return false;
  const set = getCacheIfLoaded<Set<string>>(SLUG, tenant.id!);
  if (!set) return false;
  return set.has(tenant.actorId);
}

/** Add an actor id to its tenant's partition. */
export async function rememberActor(
  tenant: Tenant,
): Promise<void> {
  if (!tenant.actorId) return;
  const key = ensureRegistered(tenant.id!);
  const set = await getCache<Set<string>>(SLUG, key);
  set.add(tenant.actorId);
}

/** Remove an actor id from its tenant's partition. */
export async function forgetActor(
  tenant: Tenant,
): Promise<void> {
  if (!tenant.actorId) return;
  const key = ensureRegistered(tenant.id!);
  const set = await getCache<Set<string>>(SLUG, key);
  set.delete(tenant.actorId);
}

/** Force-reload a single tenant's partition from the DB. */
export async function reloadTenant(tenant: Tenant): Promise<void> {
  const key = ensureRegistered(tenant.id!);
  await updateCache<Set<string>>(SLUG, key);
}
