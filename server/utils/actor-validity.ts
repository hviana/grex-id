import "server-only";

import type { Tenant } from "@/src/contracts/tenant";
import { genericList } from "../db/queries/generics.ts";

/**
 * Actor-validity cache (§8.11).
 *
 * Per-tenant `Set<actorId>` holding the ids of every actor that is
 * currently allowed to authenticate against the tenant. An actor id is
 * valid iff it appears in its tenant's set; absence IS revocation.
 *
 * Plain in-memory Map — no dependency on cache.ts. Actor validity is
 * inherently per-request, in-memory.
 */

const partitions = new Map<string, Set<string>>();
const loadedTenants = new Set<string>();

async function loadTenantPartition(tenantId: string): Promise<Set<string>> {
  const result = await genericList<{ id: string }>(
    {
      table: "api_token",
      select: "id",
      tenant: { id: tenantId },
      extraConditions: ["revokedAt IS NONE"],
      extraAccessFields: ["revokedAt"],
      allowRawExtraConditions: true,
      limit: 10000,
    },
  );

  const set = new Set<string>();
  for (const row of result.items) {
    set.add(String(row.id));
  }
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
  if (loadedTenants.has(tenant.id)) return;
  const set = await loadTenantPartition(tenant.id);
  partitions.set(tenant.id, set);
  loadedTenants.add(tenant.id);
}

/**
 * Single verification function — the only read used by withAuth.
 */
export function isActorValid(tenant: Tenant): boolean {
  if (!tenant.actorId) return false;
  return partitions.get(tenant.id!)?.has(tenant.actorId) ?? false;
}

/** Add an actor id to its tenant's partition. */
export async function rememberActor(
  tenant: Tenant,
): Promise<void> {
  if (!tenant.actorId || !tenant.id) return;
  let set = partitions.get(tenant.id);
  if (!set) {
    set = new Set();
    partitions.set(tenant.id, set);
    loadedTenants.add(tenant.id);
  }
  set.add(tenant.actorId);
}

/** Remove an actor id from its tenant's partition. */
export async function forgetActor(
  tenant: Tenant,
): Promise<void> {
  if (!tenant.actorId || !tenant.id) return;
  partitions.get(tenant.id)?.delete(tenant.actorId);
}

/** Force-reload a single tenant's partition from the DB. */
export async function reloadTenant(tenant: Tenant): Promise<void> {
  if (!tenant.id) return;
  const set = await loadTenantPartition(tenant.id);
  partitions.set(tenant.id, set);
  loadedTenants.add(tenant.id);
}
