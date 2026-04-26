DEFINE TABLE connected_app SCHEMAFULL;
DEFINE FIELD name            ON connected_app TYPE string;
DEFINE FIELD tenantIds       ON connected_app TYPE array<record<tenant>, 1> DEFAULT [];
DEFINE FIELD roles           ON connected_app TYPE array<string>;
DEFINE FIELD monthlySpendLimit ON connected_app TYPE option<int>;
DEFINE FIELD maxOperationCount ON connected_app TYPE option<object> FLEXIBLE;
DEFINE FIELD apiTokenId      ON connected_app TYPE option<record<api_token>>;
DEFINE FIELD createdAt       ON connected_app TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_ca_tenant     ON connected_app FIELDS tenantIds;
DEFINE INDEX idx_ca_api_token  ON connected_app FIELDS apiTokenId;
