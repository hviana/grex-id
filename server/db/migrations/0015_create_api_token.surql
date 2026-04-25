DEFINE TABLE api_token SCHEMAFULL;
DEFINE FIELD userId          ON api_token TYPE option<record<user>>;
DEFINE FIELD companyId       ON api_token TYPE record<company>;
DEFINE FIELD systemId        ON api_token TYPE record<system>;
DEFINE FIELD name            ON api_token TYPE string;
DEFINE FIELD description     ON api_token TYPE option<string>;
DEFINE FIELD permissions     ON api_token TYPE array<string>;
DEFINE FIELD monthlySpendLimit ON api_token TYPE option<int>;
DEFINE FIELD neverExpires   ON api_token TYPE option<bool> DEFAULT false;
DEFINE FIELD frontendUse    ON api_token TYPE option<bool> DEFAULT false;
DEFINE FIELD frontendDomains ON api_token TYPE option<array<string>> DEFAULT [];
DEFINE FIELD maxOperationCount ON api_token TYPE option<object> FLEXIBLE;
DEFINE FIELD revokedAt      ON api_token TYPE option<datetime>;
DEFINE FIELD expiresAt       ON api_token TYPE option<datetime>;
DEFINE FIELD createdAt       ON api_token TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_at_user_company   ON api_token FIELDS userId, companyId, systemId;
DEFINE INDEX idx_at_tenant_revoked ON api_token FIELDS companyId, systemId, revokedAt;
DEFINE INDEX idx_at_revoked        ON api_token FIELDS revokedAt;
