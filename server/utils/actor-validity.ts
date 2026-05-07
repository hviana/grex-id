import "server-only";

import type { Tenant } from "@/src/contracts/tenant";
import { genericList } from "../db/queries/generics.ts";
import { getDb } from "../db/connection.ts";
import { getState } from "../global-registry.ts";

/**
 * Actor-validity cache (§8.11).
 *
 * Per-tenant `Set<actorId>` holding the ids of every actor that is
 * currently allowed to authenticate against the tenant. An actor id is
 * valid iff it appears in its tenant's set; absence IS revocation.
 *
 * State is stored on `globalThis` so that Turbopack module-instance
 * splitting does not silently create separate caches (login calls
 * `rememberActor` from `app/api/` via `@/` alias; middleware reads
 * `isActorValid` via relative import → different module instances
 * WITHOUT globalThis).
 */

interface ActorValidityState {
  partitions: Map<string, Set<string>>;
  loadedTenants: Set<string>;
}

const state = getState<ActorValidityState>("actor-validity", {
  partitions: new Map(),
  loadedTenants: new Set(),
});

async function loadTenantPartition(tenantId: string): Promise<Set<string>> {
  const db = await getDb();
  const [tokenIds, tenantActorIds] = await db.query<[string[], string[]]>(
    `SELECT VALUE id FROM api_token WHERE tenantIds CONTAINS $tenantId AND revokedAt IS NONE;
     SELECT VALUE actorId FROM $tenantId WHERE actorId != NONE`,
    { tenantId },
  );

  const set = new Set<string>();
  for (const id of (tokenIds ?? [])) set.add(String(id));
  for (const id of (tenantActorIds ?? [])) if (id) set.add(String(id));
  return set;
}

/**
 * Hydrates the tenant's partition on first access. `withAuth` awaits this
 * once per request before the synchronous `isActorValid` check.
 */
export async function ensureActorValidityLoaded(
  tenant: Tenant,
): Promise<void> {
  if (!tenant.id) return;
  if (state.loadedTenants.has(tenant.id)) return;
  const set = await loadTenantPartition(tenant.id);
  state.partitions.set(tenant.id, set);
  state.loadedTenants.add(tenant.id);
}

/**
 * Single verification function — the only read used by withAuth.
 */
export function isActorValid(tenant: Tenant): boolean {
  if (!tenant.actorId) return false;
  return state.partitions.get(tenant.id!)?.has(tenant.actorId) ?? false;
}

/** Add an actor id to its tenant's partition. */
export async function rememberActor(
  tenant: Tenant,
): Promise<void> {
  if (!tenant.actorId || !tenant.id) return;
  let set = state.partitions.get(tenant.id);
  if (!set) {
    set = new Set();
    state.partitions.set(tenant.id, set);
    state.loadedTenants.add(tenant.id);
  }
  set.add(tenant.actorId);
}

/** Remove an actor id from its tenant's partition. */
export async function forgetActor(
  tenant: Tenant,
): Promise<void> {
  if (!tenant.actorId || !tenant.id) return;
  state.partitions.get(tenant.id)?.delete(tenant.actorId);
}

/** Force-reload a single tenant's partition from the DB. */
export async function reloadTenant(tenant: Tenant): Promise<void> {
  if (!tenant.id) return;
  const set = await loadTenantPartition(tenant.id);
  state.partitions.set(tenant.id, set);
  state.loadedTenants.add(tenant.id);
}
