-- Extend api_token with tenant embedding, revocation, and frontend CORS fields
DEFINE FIELD tenant         ON api_token TYPE option<object> FLEXIBLE;
DEFINE FIELD jti            ON api_token TYPE option<string>;
DEFINE FIELD neverExpires   ON api_token TYPE option<bool> DEFAULT false;
DEFINE FIELD frontendUse    ON api_token TYPE option<bool> DEFAULT false;
DEFINE FIELD frontendDomains ON api_token TYPE option<array<string>> DEFAULT [];
DEFINE FIELD revokedAt      ON api_token TYPE option<datetime>;

DEFINE INDEX idx_at_jti      ON api_token FIELDS jti UNIQUE;
DEFINE INDEX idx_at_revoked  ON api_token FIELDS revokedAt;
