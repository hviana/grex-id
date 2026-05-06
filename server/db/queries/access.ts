import "server-only";

import { getDb, rid } from "../connection.ts";

/** Deletes user-access tenant rows for a given user, scoped to the
 *  provided tenant ids. Used by the access-removal flow for users. */
export async function deleteUserTenantAccess(
  userId: string,
  tenantIds: string[],
): Promise<void> {
  const db = await getDb();
  const resolvedIds = tenantIds.map((id) => rid(id));
  await db.query(
    `DELETE FROM tenant WHERE id IN $ids AND actorId = $actorId`,
    { ids: resolvedIds, actorId: rid(userId) },
  );
}
