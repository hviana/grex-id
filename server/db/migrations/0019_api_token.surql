DEFINE TABLE api_token SCHEMAFULL;
DEFINE FIELD tenantIds         ON api_token TYPE array<record<tenant>, 1> DEFAULT [];
DEFINE FIELD name              ON api_token TYPE string;
DEFINE FIELD description       ON api_token TYPE option<string>;
DEFINE FIELD roles             ON api_token TYPE array<string>;
DEFINE FIELD monthlySpendLimit ON api_token TYPE option<int>;
DEFINE FIELD neverExpires      ON api_token TYPE option<bool> DEFAULT false;
DEFINE FIELD frontendUse       ON api_token TYPE option<bool> DEFAULT false;
DEFINE FIELD frontendDomains   ON api_token TYPE option<array<string>> DEFAULT [];
DEFINE FIELD maxOperationCount ON api_token TYPE option<object> FLEXIBLE;
DEFINE FIELD revokedAt         ON api_token TYPE option<datetime>;
DEFINE FIELD expiresAt         ON api_token TYPE option<datetime>;
DEFINE FIELD createdAt         ON api_token TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_at_tenant_revoked ON api_token FIELDS tenantIds, revokedAt;
DEFINE INDEX idx_at_revoked        ON api_token FIELDS revokedAt;
