DEFINE TABLE credit_expense SCHEMAFULL;
DEFINE FIELD tenantIds   ON credit_expense TYPE array<record<tenant>, 1> DEFAULT [];
DEFINE FIELD resourceKey  ON credit_expense TYPE string;
DEFINE FIELD amount       ON credit_expense TYPE number;
DEFINE FIELD count        ON credit_expense TYPE number DEFAULT 0;
DEFINE FIELD day          ON credit_expense TYPE string;
DEFINE FIELD createdAt    ON credit_expense TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_ce_tenant_day ON credit_expense FIELDS tenantIds, day;
DEFINE INDEX idx_ce_resource   ON credit_expense FIELDS tenantIds, resourceKey, day UNIQUE;
