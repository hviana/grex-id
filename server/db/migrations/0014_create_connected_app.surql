DEFINE TABLE connected_app SCHEMAFULL;
DEFINE FIELD name            ON connected_app TYPE string;
DEFINE FIELD companyId       ON connected_app TYPE record<company>;
DEFINE FIELD systemId        ON connected_app TYPE record<system>;
DEFINE FIELD permissions     ON connected_app TYPE array<string>;
DEFINE FIELD monthlySpendLimit ON connected_app TYPE option<int>;
DEFINE FIELD createdAt       ON connected_app TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_ca_company_system ON connected_app FIELDS companyId, systemId;
