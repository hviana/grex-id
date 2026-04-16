-- JTI-based token revocation table for user-session JWTs
-- Rows TTL to the original exp, keeping the table bounded
DEFINE TABLE token_revocation SCHEMAFULL;
DEFINE FIELD jti        ON token_revocation TYPE string;
DEFINE FIELD reason     ON token_revocation TYPE option<string>;
DEFINE FIELD revokedAt  ON token_revocation TYPE datetime DEFAULT time::now();
DEFINE FIELD expiresAt  ON token_revocation TYPE datetime;

DEFINE INDEX idx_tr_jti ON token_revocation FIELDS jti UNIQUE;
