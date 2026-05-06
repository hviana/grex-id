DEFINE TABLE plan SCHEMAFULL;
DEFINE FIELD name             ON plan TYPE string;
DEFINE FIELD description      ON plan TYPE string;
DEFINE FIELD tenantIds        ON plan TYPE set<record<tenant>, 1> DEFAULT <set>[];
DEFINE FIELD price            ON plan TYPE int;
DEFINE FIELD currency         ON plan TYPE string DEFAULT "USD";
DEFINE FIELD recurrenceDays   ON plan TYPE int;
DEFINE FIELD isActive         ON plan TYPE bool DEFAULT true;
DEFINE FIELD resourceLimitId         ON plan TYPE record<resource_limit>;
DEFINE FIELD createdAt        ON plan TYPE datetime DEFAULT time::now();
DEFINE FIELD updatedAt        ON plan TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_plan_name ON TABLE plan FIELDS name FULLTEXT ANALYZER general_analyzer_fts BM25;
DEFINE INDEX idx_plan_tenant ON plan FIELDS tenantIds;
DEFINE INDEX idx_plan_active ON plan FIELDS tenantIds, isActive;
DEFINE INDEX idx_at_plan_resource_limit        ON plan FIELDS resourceLimitId;
