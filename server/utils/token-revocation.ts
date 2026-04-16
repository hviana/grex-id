import { getDb, rid } from "../db/connection.ts";

if (typeof window !== "undefined") {
  throw new Error(
    "token-revocation.ts must not be imported in client-side code.",
  );
}

/**
 * Revokes a JTI by inserting into the token_revocation table.
 * For user-session JWTs: inserts with an expiresAt matching the original token exp
 * so the table stays bounded (cleanup job removes expired rows).
 * For never-expiring API tokens: uses api_token.revokedAt directly instead.
 */
export async function revokeJti(
  jti: string,
  reason: string,
  expiresAt?: Date,
): Promise<void> {
  const db = await getDb();

  if (expiresAt) {
    // User-session JWT: insert into TTL revocation table
    await db.query(
      `INSERT INTO token_revocation (jti, reason, expiresAt) VALUES ($jti, $reason, $expiresAt)
       ON DUPLICATE KEY UPDATE reason = $reason, revokedAt = time::now()`,
      { jti, reason, expiresAt },
    );
  } else {
    // Never-expiring token: just record without expiry (cleanup handled by token-cleanup job)
    await db.query(
      `INSERT INTO token_revocation (jti, reason, expiresAt) VALUES ($jti, $reason, time::now() + 90d)
       ON DUPLICATE KEY UPDATE reason = $reason, revokedAt = time::now()`,
      { jti, reason },
    );
  }
}

/**
 * Checks whether a JTI has been revoked.
 * Checks both the token_revocation table and api_token.revokedAt.
 */
export async function isJtiRevoked(jti: string): Promise<boolean> {
  const db = await getDb();

  // Check revocation table
  const revoked = await db.query<[{ id: string }[]]>(
    `SELECT id FROM token_revocation WHERE jti = $jti LIMIT 1`,
    { jti },
  );
  if (revoked[0] && revoked[0].length > 0) return true;

  // Check api_token.revokedAt
  const token = await db.query<[{ revokedAt: string | null }[]]>(
    `SELECT revokedAt FROM api_token WHERE jti = $jti LIMIT 1`,
    { jti },
  );
  if (token[0]?.[0]?.revokedAt) return true;

  return false;
}

/**
 * Revokes an API token by setting revokedAt on its record.
 * Used when deleting tokens from the panel.
 */
export async function revokeApiToken(
  tokenId: string,
  reason: string,
): Promise<void> {
  const db = await getDb();
  await db.query(
    `UPDATE $id SET revokedAt = time::now() WHERE revokedAt IS NONE`,
    { id: rid(tokenId) },
  );

  // Also record in revocation table if jti exists
  const jti = await db.query<[{ jti: string }[]]>(
    `SELECT jti FROM $id LIMIT 1`,
    { id: rid(tokenId) },
  );
  if (jti[0]?.[0]?.jti) {
    await revokeJti(jti[0][0].jti, reason);
  }
}
