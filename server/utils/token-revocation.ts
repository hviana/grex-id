import { getDb, rid } from "../db/connection.ts";
import { assertServerOnly } from "./server-only.ts";

assertServerOnly("token-revocation.ts");

/**
 * Revokes a JTI by inserting into the token_revocation table.
 * For user-session JWTs: inserts with an expiresAt matching the original token exp
 * so the table stays bounded (cleanup job removes expired rows).
 * For never-expiring API tokens: uses a 90-day TTL instead.
 */
export async function revokeJti(
  jti: string,
  reason: string,
  expiresAt?: Date,
): Promise<void> {
  const db = await getDb();

  const exp = expiresAt ?? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

  await db.query(
    `INSERT INTO token_revocation (jti, reason, expiresAt) VALUES ($jti, $reason, $expiresAt)
     ON DUPLICATE KEY UPDATE reason = $reason, expiresAt = $expiresAt`,
    { jti, reason, expiresAt: exp },
  );
}

/**
 * Checks whether a JTI has been revoked.
 * Batches revocation table + api_token check into a single query.
 */
export async function isJtiRevoked(jti: string): Promise<boolean> {
  const db = await getDb();

  const result = await db.query<
    [{ id: string }[], { revokedAt: string | null }[]]
  >(
    `SELECT id FROM token_revocation WHERE jti = $jti LIMIT 1;
     SELECT revokedAt FROM api_token WHERE jti = $jti AND revokedAt IS NOT NONE LIMIT 1;`,
    { jti },
  );

  // Revocation table hit
  if (result[0]?.length > 0) return true;

  // api_token with revokedAt
  if (result[1]?.length > 0) return true;

  return false;
}

/**
 * Revokes an API token by setting revokedAt on its record + inserting into
 * the revocation table — all in a single batched query.
 */
export async function revokeApiToken(
  tokenId: string,
  reason: string,
): Promise<void> {
  const db = await getDb();

  await db.query(
    `UPDATE $id SET revokedAt = time::now() WHERE revokedAt IS NONE;
     LET $jti = (SELECT jti FROM $id LIMIT 0,1)[0].jti;
     IF $jti != NONE {
       INSERT INTO token_revocation (jti, reason, expiresAt) VALUES ($jti, $reason, time::now() + 90d)
         ON DUPLICATE KEY UPDATE reason = $reason;
     }`,
    { id: rid(tokenId), reason },
  );
}
