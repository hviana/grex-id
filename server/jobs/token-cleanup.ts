import { getDb } from "../db/connection.ts";
import { getSystemTenant } from "../utils/tenant.ts";
import { assertServerOnly } from "../utils/server-only.ts";

assertServerOnly("token-cleanup");

const CLEANUP_INTERVAL_MS = 86_400_000; // 24 hours
const REVOKED_OLDER_THAN_DAYS = 90;

/**
 * Daily job under the system Tenant (§16).
 * Hard-deletes api_token rows where revokedAt > 90 days.
 * Cleans orphaned connected_app rows whose underlying token was removed.
 */
export function startTokenCleanup(): void {
  async function runCleanup() {
    try {
      const _tenant = getSystemTenant();
      const db = await getDb();

      const result = await db.query<
        [unknown, { count: number }[], { count: number }[]]
      >(
        `LET $cutoff = time::now() - 90d;
         DELETE FROM api_token WHERE revokedAt IS NOT NONE AND revokedAt < $cutoff RETURN count() AS count;
         DELETE FROM connected_app WHERE apiTokenId NOT IN (SELECT VALUE id FROM api_token) RETURN count() AS count;`,
      );

      const tokensDeleted = result[1]?.[0]?.count ?? 0;
      const appsDeleted = result[2]?.[0]?.count ?? 0;

      if (tokensDeleted > 0 || appsDeleted > 0) {
        // No actor-validity touch: rows hard-deleted here had
        // `revokedAt IS NOT NONE` for >90 days, so `forgetActor` was
        // already called on each at revocation time (§12.8). The in-memory
        // partitions do not hold these ids.
        console.log(
          `[token-cleanup] Removed ${tokensDeleted} revoked tokens (>${REVOKED_OLDER_THAN_DAYS}d) and ${appsDeleted} orphaned connected apps.`,
        );
      }
    } catch (err) {
      console.error("[token-cleanup] Error:", err);
    }
  }

  setInterval(runCleanup, CLEANUP_INTERVAL_MS);
  console.log(
    `[token-cleanup] Token cleanup job started (daily, ${REVOKED_OLDER_THAN_DAYS}-day threshold).`,
  );
}
