DEFINE TABLE api_token SCHEMAFULL;
DEFINE FIELD tenantIds         ON api_token TYPE set<record<tenant>, 1> DEFAULT <set>[];
DEFINE FIELD name              ON api_token TYPE string;
DEFINE FIELD description       ON api_token TYPE option<string>;
DEFINE FIELD actorType      ON api_token TYPE string
  ASSERT $value IN ["app", "token"];
DEFINE FIELD neverExpires      ON api_token TYPE option<bool> DEFAULT false;
DEFINE FIELD revokedAt         ON api_token TYPE option<datetime>;
DEFINE FIELD expiresAt         ON api_token TYPE option<datetime>;
DEFINE FIELD resourceLimitId         ON api_token TYPE record<resource_limit>;
DEFINE FIELD createdAt         ON api_token TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_at_tenant_revoked ON api_token FIELDS tenantIds, revokedAt;
DEFINE INDEX idx_at_revoked        ON api_token FIELDS revokedAt;
DEFINE INDEX idx_at_api_token_resource_limit        ON api_token FIELDS resourceLimitId;
